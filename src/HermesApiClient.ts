import { Notice, TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';
import type { SecretsManager } from './SecretsManager.ts';
import type { ChatClient, ChatSessionUpdate } from './ChatClient.ts';

export interface HermesApiMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
}

export interface PromptContextItem {
  id: string;
  text: string;
  type: 'folder' | 'note' | 'selection' | 'image' | 'pdf';
  data?: string;
  mimeType?: string;
}

/**
 * Client for the Hermes Agent REST API with Server-Sent Events streaming.
 *
 * Provides the same interface shape as AcpClient so the UI can use either
 * backend without changes.
 */
export class HermesApiClient implements ChatClient {
  private messageCallbacks: Array<(update: ChatSessionUpdate) => void> = [];
  private errorCallbacks: Array<(error: string) => void> = [];
  private commandsCallbacks: Array<(commands: Array<{ description: string; name: string }>) => void> = [];
  private lastAvailableCommands: Array<{ description: string; name: string }> = [];
  private isConnecting = false;
  private activeAbortController: AbortController | null = null;
  private readonly plugin: Plugin;
  private readonly secrets: SecretsManager;

  // Auto-reconnection state
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly BASE_RECONNECT_DELAY_MS = 1000;
  private readonly MAX_RECONNECT_DELAY_MS = 30000;
  private isReconnecting = false;

  constructor(plugin: Plugin, secrets: SecretsManager) {
    this.plugin = plugin;
    this.secrets = secrets;
  }

  /**
   * Build the base URL from settings.
   */
  private getBaseUrl(): string {
    return this.plugin.settings.hermesApiUrl.replace(/\/$/, '');
  }

  /**
   * Retrieve the API key from secure storage.
   */
  private async getApiKey(): Promise<string> {
    return this.secrets.get('apiKey');
  }

  /**
   * Check if the client has valid configuration.
   */
  public isReady(): boolean {
    return Boolean(this.plugin.settings.hermesApiUrl);
  }

  /**
   * No-op for API client — connection is stateless.
   */
  public async connect(): Promise<void> {
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
  public getConnectionState(): { isReconnecting: boolean; reconnectAttempt: number; maxAttempts: number } {
    return {
      isReconnecting: this.isReconnecting,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      reconnectAttempt: this.reconnectAttempts
    };
  }

  /**
   * Schedule an automatic reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.emit({ type: 'message', content: '🔌 API connection lost. Max reconnection attempts reached. Please reconnect manually.' });
      this.plugin.auditLog.recordConnection('reconnect', 'api', 'failure', 'Max reconnection attempts reached');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      this.MAX_RECONNECT_DELAY_MS
    );

    this.emit({
      type: 'message',
      content: `🔌 Reconnecting to Hermes API (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`
    });
    this.plugin.auditLog.recordConnection('reconnect', 'api', 'pending', `attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);

    this.reconnectTimeout = window.setTimeout(() => {
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

  /**
   * Cancel any pending reconnection.
   */
  private cancelReconnect(): void {
    if (this.reconnectTimeout !== null) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Send a prompt to the Hermes API and stream the response via SSE.
   */
  public async sendPrompt(text: string, contextItems: PromptContextItem[] = [], options?: { allowedTools?: string[] | null }): Promise<void> {
    // Abort any in-flight request before starting a new one to prevent connection leaks
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }

    const apiKey = await this.getApiKey();
    const url = `${this.getBaseUrl()}/v1/chat/completions`;

    const messages: Array<Record<string, unknown>> = [];

    // Inject active persona system prompt
    const activePersona = this.plugin.settings.personaTemplates.find(
      (p) => p.id === this.plugin.settings.activePersonaId
    );
    if (activePersona?.systemPrompt) {
      messages.push({ content: activePersona.systemPrompt, role: 'system' });
    }

    if (options?.allowedTools) {
      messages.push({ content: `System Instruction: You are restricted to ONLY using the following tools in this session: ${options.allowedTools.join(', ')}. Do not attempt to use any other tools.`, role: 'system' });
    }

    const userContentParts: Array<Record<string, unknown>> = [];
    for (const item of contextItems) {
      if (item.type === 'image' && item.data) {
        userContentParts.push({
          type: 'image_url',
          image_url: { url: `data:${item.mimeType || 'image/jpeg'};base64,${item.data}` }
        });
      } else if (item.type === 'pdf' && item.data) {
        userContentParts.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: item.data }
        });
      } else if (item.type === 'note') {
        const notePath = item.id.replace(/^note-/, '');
        // Handle block references: block-{path}-{startLine}
        const blockMatch = item.id.match(/^block-(.+)-(\d+)$/);
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
                userContentParts.push({ type: 'text', text: `\n\n--- Block from ${blockPath} (${block.type}) ---\n${block.content}\n` });
              } else {
                const lines = content.split('\n');
                userContentParts.push({ type: 'text', text: `\n\n--- Line from ${blockPath} ---\n${lines[startLine] ?? ''}\n` });
              }
            }
          } else {
            const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
            if (file instanceof TFile) {
              const content = await this.plugin.app.vault.read(file);
              userContentParts.push({ type: 'text', text: `\n\n--- Reference Note: ${notePath} ---\n${content}\n` });
            }
          }
        } catch {
          // Skip notes that can't be read
        }
      } else if (item.type === 'selection') {
        userContentParts.push({ type: 'text', text: `\n\n--- Selected Text ---\n${item.text}\n` });
      }
    }
    userContentParts.push({ type: 'text', text });
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
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
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
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Split by newline to process complete SSE events.
          // The last element is retained in the buffer as it may be an incomplete chunk.
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) {
              continue;
            }

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              return; // The finally block will emit the 'stop' event
            }

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
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
   * Fetch a stateless inline completion for ghost text.
   */
  public async getInlineCompletion(systemPrompt: string, userText: string): Promise<string | null> {
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
          stream: false
        }),
        headers: {
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json'
        },
        method: 'POST',
        signal: abortController.signal
      });

      if (!response.ok) return null;

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      return content ? content.trim() : null;
    } catch {
      return null;
    }
  }

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
   * No-op for REST API (cannot abort remote terminals directly through this interface).
   */
  public abortTerminal(_terminalId: string): void {}

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
   * Subscribe to available commands updates.
   */
  public onAvailableCommands(callback: (commands: Array<{ description: string; name: string }>) => void): () => void {
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
        tools?: Array<{ description?: string; name: string }>;
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
}
