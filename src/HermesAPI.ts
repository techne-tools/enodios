import { Notice } from 'obsidian';

import type { Plugin } from './Plugin.ts';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_URL = 'http://127.0.0.1:8642';

export interface HermesChatRequest {
  messages: HermesMessage[];
  model?: string;
  stream?: boolean;
}

export interface HermesChatResponse {
  choices: {
    finish_reason: string;
    index: number;
    message: HermesMessage;
  }[];
  created: number;
  id: string;
  model: string;
  object: string;
  usage?: {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface HermesMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
}

export interface HermesResponseAPI {
  created: number;
  id: string;
  model: string;
  object: string;
  output: {
    arguments?: string;
    call_id?: string;
    content?: { text?: string; type: string }[] | string;
    name?: string;
    output?: string;
    role?: string;
    type: string;
  }[];
  status: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface HermesResponseRequest {
  conversation?: string;
  input: HermesMessage[] | string;
  instructions?: string;
  model?: string;
  previous_response_id?: string;
  store?: boolean;
  stream?: boolean;
}

export class HermesAPIError extends Error {
  public readonly originalCause?: unknown;

  public constructor(message: string, originalCause?: unknown) {
    super(message);
    this.name = 'HermesAPIError';
    this.originalCause = originalCause;
  }
}

export class HermesAPI {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.baseUrl = plugin.settings.hermesApiUrl || DEFAULT_BASE_URL;
    this.apiKey = plugin.settings.hermesApiKey || '';
  }

  /**
   * Check if the Hermes API is reachable.
   */
  public async checkConnection(): Promise<boolean> {
    const endpoints = [`${this.baseUrl}/v1/health`, `${this.baseUrl}/health`];
    for (const endpoint of endpoints) {
      try {
        const response = await this.fetchWithTimeout(endpoint, {
          headers: this.getHeaders(),
          method: 'GET'
        });
        if (response.ok) {
          return true;
        }
      } catch {
        // Try next endpoint
      }
    }
    return false;
  }

  /**
   * Fetch available tools from the Hermes API server.
   *
   * NOTE: The Hermes API server must enable CORS (Access-Control-Allow-Origin)
   * for Obsidian's origin (app://obsidian.md) or allow all origins.
   * If the server returns 404, the endpoint does not exist and tools are unavailable.
   */
  public async getTools(): Promise<Array<{ description: string; name: string }> | null> {
    const endpoints = [
      `${this.baseUrl}/v1/tools`,
      `${this.baseUrl}/tools`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await this.fetchWithTimeout(endpoint, {
          headers: this.getHeaders(),
          method: 'GET'
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json() as unknown as Array<{ description?: string; name?: string }>;
        if (Array.isArray(data)) {
          return data
            .filter((tool) => typeof tool.name === 'string')
            .map((tool) => ({
              description: tool.description ?? '',
              name: tool.name
            }));
        }
      } catch {
        // Silently fail — CORS or 404 errors are expected if the endpoint is unavailable.
        // The browser console may show CORS warnings; these must be fixed server-side.
      }
    }
    return null;
  }

  /**
   * Send a message using the Responses API with server-side session management.
   */
  public async sendMessageWithResponseAPI(
    input: string,
    previousResponseId?: string,
    conversation?: string,
    instructions?: string,
    model?: string,
    store = true
  ): Promise<HermesResponseAPI | null> {
    const request: HermesResponseRequest = {
      input,
      model: model || this.plugin.settings.hermesAgentName,
      store
    };

    if (previousResponseId) {
      request.previous_response_id = previousResponseId;
    }
    if (conversation) {
      request.conversation = conversation;
    }
    if (instructions) {
      request.instructions = instructions;
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/responses`,
        {
          body: JSON.stringify(request),
          headers: this.getHeaders(),
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new HermesAPIError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as unknown as HermesResponseAPI;
      return data;
    } catch (error) {
      if (error instanceof HermesAPIError) {
        new Notice(`Hermes API error: ${error.message}`);
      } else {
        new Notice('Failed to connect to Hermes API. Check your settings.');
      }
      return null;
    }
  }

  /**
   * Send a message using OpenAI-compatible chat completions.
   */
  public async sendMessage(
    messages: HermesMessage[],
    model?: string,
    stream = false
  ): Promise<HermesChatResponse | null> {
    const request: HermesChatRequest = {
      messages,
      model: model || this.plugin.settings.hermesAgentName,
      stream
    };

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          body: JSON.stringify(request),
          headers: this.getHeaders(),
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new HermesAPIError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as unknown as HermesChatResponse;
      return data;
    } catch (error) {
      if (error instanceof HermesAPIError) {
        new Notice(`Hermes API error: ${error.message}`);
      } else {
        new Notice('Failed to connect to Hermes API. Check your settings.');
      }
      return null;
    }
  }

  /**
   * Send a message using OpenAI-compatible chat completions with streaming.
   * Calls onChunk for each streamed text chunk, and onDone when complete.
   */
  public async sendMessageStream(
    messages: HermesMessage[],
    onChunk: (chunk: string) => void,
    onDone: () => void,
    onError: (error: string) => void,
    model?: string
  ): Promise<void> {
    const request: HermesChatRequest = {
      messages,
      model: model || this.plugin.settings.hermesAgentName,
      stream: true
    };

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/v1/chat/completions`,
        {
          body: JSON.stringify(request),
          headers: this.getHeaders(),
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new HermesAPIError(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new HermesAPIError('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6)) as unknown as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                onChunk(content);
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      }

      onDone();
    } catch (error) {
      if (error instanceof HermesAPIError) {
        onError(error.message);
      } else {
        onError('Failed to connect to Hermes API. Check your settings.');
      }
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit & { timeout?: number }
  ): Promise<Response> {
    const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HermesAPIError(`Request timed out after ${String(timeout)}ms`);
      }
      throw new HermesAPIError('Network error', error);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  /**
   * Retry a fetch operation with exponential backoff.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit & { timeout?: number },
    retries = 2
  ): Promise<Response> {
    let lastError: HermesAPIError | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, options);
        if (response.ok || response.status >= 400 && response.status < 500) {
          // Don't retry client errors (4xx)
          return response;
        }
        lastError = new HermesAPIError(`HTTP ${String(response.status)}: ${response.statusText}`);
      } catch (error) {
        if (error instanceof HermesAPIError) {
          lastError = error;
        } else {
          lastError = new HermesAPIError('Unknown error', error);
        }
      }

      if (attempt < retries) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new HermesAPIError('Max retries exceeded');
  }
}
