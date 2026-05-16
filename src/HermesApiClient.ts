import { Notice } from 'obsidian';

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
  type: 'folder' | 'note' | 'selection';
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
  private readonly plugin: Plugin;
  private readonly secrets: SecretsManager;

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
    // Stateless — nothing to clean up
  }

  /**
   * Send a prompt to the Hermes API and stream the response via SSE.
   */
  public async sendPrompt(text: string, _contextItems: PromptContextItem[] = []): Promise<void> {
    const apiKey = await this.getApiKey();
    const url = `${this.getBaseUrl()}/v1/chat/completions`;

    const response = await fetch(url, {
      body: JSON.stringify({
        messages: [{ content: text, role: 'user' }],
        model: this.plugin.settings.hermesAgentName,
        stream: true
      }),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      method: 'POST'
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
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) {
            continue;
          }

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            this.emit({ type: 'stop' });
            return;
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
              this.emit({ type: 'stop' });
              return;
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
  }

  /**
   * Cancel is a no-op for the REST API (no mid-request cancellation).
   */
  public async cancel(): Promise<void> {
    // Not supported over REST
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
