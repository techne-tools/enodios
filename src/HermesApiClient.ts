import {
 Notice,
TFile
} from 'obsidian';

import type {
 AcpConnectionStatus,
 ChatClient,
ChatSessionUpdate
} from './ChatClient.ts';
import type { Plugin } from './Plugin.ts';
import type { SecretsManager } from './SecretsManager.ts';
import type { PromptContextItem } from './AcpClient.ts';

export interface HermesApiMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
}

/**
 * Client for the Hermes Agent REST API with Server-Sent Events streaming.
 *
 * ARCHITECTURAL ROLE:
 * This is the "remote" backend counterpart to AcpClient (the "local" backend).
 * Both implement the ChatClient interface, allowing the Plugin and UI layers
 * to treat them interchangeably. Switching between ACP and API mode is just
 * swapping which client instance `getChatClient()` returns.
 *
 * KEY DIFFERENCES FROM AcpClient:
 * - Stateless: no persistent subprocess or session ID
 * - SSE streaming instead of JSON-RPC over stdio
 * - No terminal emulation (abortTerminal is a no-op)
 * - File changes go through the standard REST toolset, not the ACP
 *   fs/write_text_file client method, so there is NO inline diff approval
 *   flow in API mode — the agent writes directly via its native tools.
 */

export class HermesApiClient implements ChatClient {
  private activeAbortController: AbortController | null = null;
  private readonly BASE_RECONNECT_DELAY_MS = 1000;
  private commandsCallbacks: ((commands: { description: string; name: string }[]) => void)[] = [];
  private errorCallbacks: ((error: string) => void)[] = [];
  private isConnecting = false;
  private isReconnecting = false;
  private lastAvailableCommands: { description: string; name: string }[] = [];
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  private readonly MAX_RECONNECT_DELAY_MS = 30000;
  private messageCallbacks: ((update: ChatSessionUpdate) => void)[] = [];
  private readonly plugin: Plugin;
  // Auto-reconnection state
  private reconnectAttempts = 0;
  private reconnectTimeout: null | ReturnType<typeof setTimeout> = null;
  private readonly secrets: SecretsManager;
  // Rate limiting: prevent accidental or malicious prompt flooding
  private lastPromptTime = 0;
  private readonly PROMPT_RATE_LIMIT_MS = 1000;

  constructor(plugin: Plugin, secrets: SecretsManager) {
    this.plugin = plugin;
    this.secrets = secrets;
  }

  /**
   * No-op for REST API (cannot abort remote terminals directly through this interface).
   */
  public abortTerminal(_terminalId: string): void {}

  /**
   * Abort the active SSE stream connection.
   */
  public async cancel(): Promise<void> {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  /**
   * No-op for API client — connection is stateless.
   */
  public async connect(): Promise<void> {
    if (!this.isReady()) {
      return;
    }
    if (this.isConnecting) {
      return;
    }
    this.isConnecting = true;
    try {
      // Verify connectivity by fetching available commands
      await this.fetchAvailableCommands();
      new Notice('Connected to Hermes via API');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Hermes API connection failed: ${message}`);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * No-op for API client.
   */
  public disconnect(): void {
    this.cancelReconnect();
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  /**
   * Get current reconnection state for UI display.
   */
  public getConnectionState(): { isReconnecting: boolean; maxAttempts: number; reconnectAttempt: number } {
    return {
      isReconnecting: this.isReconnecting,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      reconnectAttempt: this.reconnectAttempts
    };
  }

  /**
   * Fetch stateless inline completions for ghost text.
   */
  public async getInlineCompletions(systemPrompt: string, userText: string): Promise<null | string[]> {
    if (!this.isReady()) {
      new Notice('Hermes API URL is not configured.');
      return null;
    }

    const apiKey = await this.getApiKey();
    const url = `${this.getBaseUrl()}/v1/chat/completions`;

    // Create a local abort controller for this request
    const abortController = new AbortController();

    try {
      const response = await fetch(url, {
        body: JSON.stringify({
          messages: [
            { content: systemPrompt, role: 'system' },
            { content: userText, role: 'user' }
          ],
          model: this.plugin.settings.hermesAgentName,
          n: 3,
          stream: false
        }),
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST',
        signal: abortController.signal
      });

      if (!response.ok) { return null; }

      const data = await response.json() as {
        choices?: { message?: { content?: string } }[];
      };

      if (!data.choices || data.choices.length === 0) { return null; }

      const completions = data.choices
        .map((choice) => choice.message?.content?.trim())
        .filter((content): content is string => Boolean(content));

      return completions.length > 0 ? completions : null;
    } catch (error) {
      // Log at debug level so users aren't spammed, but developers can trace
      // why inline completion stopped working (network, JSON parse, etc.)
      this.plugin.debug.error('Inline completion request failed', error);
      return null;
    }
  }

  /**
   * Check if the client has valid configuration.
   */
  public isReady(): boolean {
    return Boolean(this.plugin.settings.hermesApiUrl);
  }

  /**
   * Subscribe to available commands updates.
   */
  public onAvailableCommands(callback: (commands: { description: string; name: string }[]) => void): () => void {
    this.commandsCallbacks.push(callback);
    if (this.lastAvailableCommands.length > 0) {
      try {
        callback(this.lastAvailableCommands);
      } catch {
        // Ignore
      }
    }
    return () => {
      const index = this.commandsCallbacks.indexOf(callback);
      if (index >= 0) {
        this.commandsCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to connection status updates. API mode connects instantly, so
   * we immediately report connected and never emit loading states.
   */
  public onConnectionStatus(callback: (status: AcpConnectionStatus) => void): () => void {
    try {
      callback({ state: 'connected' });
    } catch {
      // Ignore callback errors
    }
    return () => {};
  }

  /**
   * Subscribe to errors.
   */
  public onError(callback: (error: string) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index >= 0) {
        this.errorCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to session updates (message chunks, stop events).
   */
  public onUpdate(callback: (update: ChatSessionUpdate) => void): () => void {
    this.messageCallbacks.push(callback);
    return () => {
      const index = this.messageCallbacks.indexOf(callback);
      if (index >= 0) {
        this.messageCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Send a prompt to the Hermes API and stream the response via SSE.
   */
  public async sendPrompt(text: string, contextItems: PromptContextItem[] = [], options?: { allowedTools?: null | string[] }): Promise<void> {
    // Normalize empty array to null: [] means "no restrictions" (same as null),
    // not "no tools allowed". Prevents inconsistent behavior where the agent
    // gets no system instruction but the tool restriction logic rejects everything.
    const normalizedOptions = options?.allowedTools?.length
      ? { allowedTools: options.allowedTools }
      : { allowedTools: undefined as undefined | null };

    // Abort any in-flight request before starting a new one to prevent connection leaks
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    // Rate limiting: prevent accidental or malicious prompt flooding
    const now = Date.now();
    if (now - this.lastPromptTime < this.PROMPT_RATE_LIMIT_MS) {
      throw new Error('Please wait a moment before sending another prompt.');
    }
    this.lastPromptTime = now;

    const apiKey = await this.getApiKey();

    // SECURITY: Fail fast if API key is required but missing.
    // Sending unauthenticated requests may leak information through
    // server error responses and wastes network resources.
    if (!apiKey) {
      throw new Error('API key is not configured. Please set your API key in Hermes settings.');
    }

    const url = `${this.getBaseUrl()}/v1/chat/completions`;

    const messages: Record<string, unknown>[] = [];

    // Inject active persona system prompt
    const activePersona = this.plugin.settings.personaTemplates.find(
      (p) => p.id === this.plugin.settings.activePersonaId
    );
    if (activePersona?.systemPrompt) {
      messages.push({ content: activePersona.systemPrompt, role: 'system' });
    }

    if (normalizedOptions.allowedTools?.length) {
      messages.push({ content: `System Instruction: You are restricted to ONLY using the following tools in this session: ${normalizedOptions.allowedTools.join(', ')}. Do not attempt to use any other tools.`, role: 'system' });
    } else if (normalizedOptions.allowedTools !== null && this.plugin.settings.personaTemplates.find((p) => p.id === this.plugin.settings.activePersonaId)?.defaultTools) {
      // Apply persona default tool restrictions when no explicit session override is set
      const defaultTools = this.plugin.settings.personaTemplates.find((p) => p.id === this.plugin.settings.activePersonaId)?.defaultTools;
      if (defaultTools && defaultTools.length > 0) {
        messages.push({ content: `System Instruction: You are restricted to ONLY using the following tools in this session: ${defaultTools.join(', ')}. Do not attempt to use any other tools.`, role: 'system' });
      }
    }

    // Workspace context note for the Hermes API mode.
    // In ACP mode the agent's native tools (write_file, patch, read_file)
    // can write directly to the vault filesystem with user approval.
    // In API mode, no ACP permission flow exists, so the agent uses its
    // standard toolset against the provided workspace path.
    const workspaceNote: string[] = [
      '## Workspace Note',
      '',
      `Your working directory is: ${this.plugin.app.vault.getRoot().path}`,
      'All file operations (write_file, patch, read_file, search_files) run here.',
      '',
      '### Terminal access'
    ];

    if (this.plugin.settings.allowTerminal) {
      workspaceNote.push('Terminal commands (terminal, bash) are enabled via settings.');
    } else {
      workspaceNote.push('Terminal commands are DISABLED via settings.');
    }

    // Add session-level tool restrictions
    if (normalizedOptions.allowedTools?.length) {
      workspaceNote.push(
        '',
        `For this session you are RESTRICTED to ONLY: ${normalizedOptions.allowedTools.join(', ')}.`
      );
    }

    messages.push({ content: workspaceNote.join('\n'), role: 'system' });

    const userContentParts: Record<string, unknown>[] = [];
    for (const item of contextItems) {
      if (item.type === 'image' && item.data) {
        userContentParts.push({
          image_url: { url: `data:${item.mimeType || 'image/jpeg'};base64,${item.data}` },
          type: 'image_url'
        });
      } else if (item.type === 'pdf' && item.data) {
        userContentParts.push({
          source: { data: item.data, media_type: 'application/pdf', type: 'base64' },
          type: 'document'
        });
      } else if (item.type === 'note') {
        const notePath = item.id.replace(/^note-/, '');
        // Handle block references: block-{path}-{startLine}
        const blockMatch = /^block-(.+)-(\d+)$/.exec(item.id);
        try {
          if (blockMatch) {
            const blockPath = blockMatch[1]!;
            const startLine = parseInt(blockMatch[2]!, 10);
            const file = this.plugin.app.vault.getAbstractFileByPath(blockPath);
            if (file instanceof TFile) {
              const content = await this.plugin.app.vault.read(file);
              const { parseBlockReferences } = await import('./utils/blockReferences.ts');
              const blocks = parseBlockReferences(content);
              const block = blocks.find((b) => b.startLine === startLine);
              if (block) {
                userContentParts.push({ text: `\n\n--- Block from ${blockPath} (${block.type}) ---\n${block.content}\n`, type: 'text' });
              } else {
                const lines = content.split('\n');
                userContentParts.push({ text: `\n\n--- Line from ${blockPath} ---\n${lines[startLine] ?? ''}\n`, type: 'text' });
              }
            }
          } else {
            const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
            if (file instanceof TFile) {
              const { getEnhancedNoteContext } = await import('./utils/contextEnhancer.ts');
              const content = await getEnhancedNoteContext(this.plugin, file);
              userContentParts.push({ text: `\n\n--- Reference Note: ${notePath} ---\n${content}\n`, type: 'text' });
            }
          }
        } catch {
          // Skip notes that can't be read
        }
      } else if (item.type === 'selection') {
        userContentParts.push({ text: `\n\n--- Selected Text ---\n${item.text}\n`, type: 'text' });
      } else if (item.type === 'folder') {
        const folderPath = item.id.replace(/^folder-/, '');
        try {
          const { getFolderContext } = await import('./utils/contextEnhancer.ts');
          const content = await getFolderContext(this.plugin, folderPath);
          userContentParts.push({ text: `\n\n--- Reference Folder: ${folderPath} ---\n${content}\n`, type: 'text' });
        } catch {
          // Skip folders that fail to load
        }
      }
    }
    userContentParts.push({ text, type: 'text' });
    messages.push({ content: userContentParts, role: 'user' });

    this.activeAbortController = new AbortController();

    try {
      const response = await fetch(url, {
        body: JSON.stringify({
          messages,
          model: this.plugin.settings.hermesAgentName,
          stream: true
        }),
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST',
        signal: this.activeAbortController.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Hermes API error ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Hermes API response has no body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush any remaining characters in the decoder
            buffer += decoder.decode();
          } else {
            buffer += decoder.decode(value, { stream: true });
          }

          // Split by newline to process complete SSE events.
          // The last element is retained in the buffer as it may be an incomplete chunk.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed?.startsWith('data:')) {
              continue;
            }

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              return; // The finally block will emit the 'stop' event
            }

            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string }; finish_reason?: string }[];
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                this.emit({ content: delta, type: 'message' });
              }
              if (parsed.choices?.[0]?.finish_reason) {
                return; // The finally block will emit the 'stop' event
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }

          if (done) {
            // Process any trailing buffer that wasn't terminated by a newline
            if (buffer.trim()) {
              const trimmed = buffer.trim();
              if (trimmed.startsWith('data:')) {
                const data = trimmed.slice(5).trim();
                if (data === '[DONE]') {
                  return;
                }
                try {
                  const parsed = JSON.parse(data) as {
                    choices?: { delta?: { content?: string }; finish_reason?: string }[];
                  };
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    this.emit({ content: delta, type: 'message' });
                  }
                  if (parsed.choices?.[0]?.finish_reason) {
                    return;
                  }
                } catch {
                  // Ignore malformed SSE lines
                }
              }
            }
            break;
          }
        }
      } finally {
        reader.releaseLock();
        this.emit({ type: 'stop' });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled the request; silently stop the generation
        this.emit({ type: 'stop' });
        return;
      }
      // Trigger auto-reconnect on network errors
      if (error instanceof Error && (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ECONNREFUSED'))) {
        this.plugin.auditLog.recordConnection('disconnect', 'api', 'failure', error.message);
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      this.activeAbortController = null;
    }
  }

  /**
   * Cancel any pending reconnection.
   */
  private cancelReconnect(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Emit an update to all subscribers.
   */
  private emit(update: ChatSessionUpdate): void {
    for (const callback of this.messageCallbacks) {
      try {
        callback(update);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Fetch available commands from the Hermes API.
   */
  private async fetchAvailableCommands(): Promise<void> {
    const apiKey = await this.getApiKey();
    const url = `${this.getBaseUrl()}/v1/tools`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json() as {
        tools?: { description?: string; name: string }[];
      };

      if (data.tools) {
        const commands = data.tools.map((t) => ({
          description: t.description ?? '',
          name: t.name
        }));
        this.lastAvailableCommands = commands;
        for (const cb of this.commandsCallbacks) {
          try {
            cb(commands);
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Silently ignore — tools endpoint may not exist
    }
  }

  /**
   * Retrieve the API key from secure storage.
   */
  private async getApiKey(): Promise<string> {
    return this.secrets.get('apiKey');
  }

  /**
   * Build the base URL from settings.
   */
  private getBaseUrl(): string {
    return this.plugin.settings.hermesApiUrl.replace(/\/$/, '');
  }

  /**
   * Schedule an automatic reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting) { return; }
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.emit({ content: '🔌 API connection lost. Max reconnection attempts reached. Please reconnect manually.', type: 'message' });
      this.plugin.auditLog.recordConnection('reconnect', 'api', 'failure', 'Max reconnection attempts reached');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      this.MAX_RECONNECT_DELAY_MS
    );

    this.emit({
      content: `🔌 Reconnecting to Hermes API (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`,
      type: 'message'
    });
    this.plugin.auditLog.recordConnection('reconnect', 'api', 'pending', `attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect()
        .then(() => {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.plugin.auditLog.recordConnection('reconnect', 'api', 'success');
        })
        .catch(() => {
          this.isReconnecting = false;
          this.scheduleReconnect();
        });
    }, delay);
  }
}
