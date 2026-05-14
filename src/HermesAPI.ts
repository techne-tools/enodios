import { Notice } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface HermesMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HermesChatRequest {
  model?: string;
  messages: HermesMessage[];
  stream?: boolean;
}

export interface HermesResponseRequest {
  model?: string;
  input: string | HermesMessage[];
  instructions?: string;
  store?: boolean;
  previous_response_id?: string;
  conversation?: string;
  stream?: boolean;
}

export interface HermesChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: HermesMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface HermesResponseAPI {
  id: string;
  object: string;
  created: number;
  model: string;
  status: string;
  output: Array<{
    type: string;
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export class HermesAPI {
  private plugin: Plugin;
  private baseUrl: string;
  private apiKey: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.baseUrl = plugin.settings.hermesApiUrl || 'http://127.0.0.1:8642';
    this.apiKey = plugin.settings.hermesApiKey || '';
    console.log('[HermesAPI] Initialized with URL:', this.baseUrl, 'Has API key:', !!this.apiKey);
  }

  /**
   * Check if the Hermes API is reachable
   */
  public async checkConnection(): Promise<boolean> {
    console.log('[HermesAPI] Checking connection to', this.baseUrl);
    try {
      // Try both /health and /v1/health endpoints
      const endpoints = [`${this.baseUrl}/v1/health`, `${this.baseUrl}/health`];
      for (const endpoint of endpoints) {
        try {
          console.log('[HermesAPI] Trying endpoint:', endpoint);
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: this.getHeaders()
          });
          console.log('[HermesAPI] Response status:', response.status, response.statusText);
          if (response.ok) {
            console.log('[HermesAPI] Connection successful!');
            return true;
          }
        } catch (error) {
          console.error(`[HermesAPI] Health check failed for ${endpoint}:`, error);
        }
      }
      console.error('[HermesAPI] Connection check failed: No valid endpoint found');
      return false;
    } catch (error) {
      console.error('[HermesAPI] Connection check failed:', error);
      return false;
    }
  }

  /**
   * Send a message to the Hermes API using OpenAI-compatible chat completions
   * This is a stateless approach - full conversation history is included in each request
   */
  public async sendMessage(
    messages: HermesMessage[],
    model?: string,
    stream: boolean = false
  ): Promise<HermesChatResponse | null> {
    try {
      const request: HermesChatRequest = {
        model: model || this.plugin.settings.hermesAgentName,
        messages: messages,
        stream: stream
      };

      console.log('[HermesAPI] Sending message to', `${this.baseUrl}/v1/chat/completions`);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request)
      });

      console.log('[HermesAPI] Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[HermesAPI] Response received:', data);
      return data as unknown as HermesChatResponse;
    } catch (error) {
      console.error('[HermesAPI] Failed to send message:', error);
      new Notice('Failed to send message. Check API settings.');
      return null;
    }
  }

  /**
   * Send a message using the Responses API with server-side session management
   * This approach maintains conversation state on the server
   */
  public async sendMessageWithResponseAPI(
    input: string,
    previousResponseId?: string,
    conversation?: string,
    instructions?: string,
    model?: string,
    store: boolean = true
  ): Promise<HermesResponseAPI | null> {
    try {
      const request: HermesResponseRequest = {
        model: model || this.plugin.settings.hermesAgentName,
        input: input,
        store: store
      };

      // Add optional parameters if provided
      if (previousResponseId) {
        request.previous_response_id = previousResponseId;
      }
      if (conversation) {
        request.conversation = conversation;
      }
      if (instructions) {
        request.instructions = instructions;
      }

      console.log('[HermesAPI] Sending message with Responses API to', `${this.baseUrl}/v1/responses`);
      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request)
      });

      console.log('[HermesAPI] Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[HermesAPI] Response received:', data);
      return data as unknown as HermesResponseAPI;
    } catch (error) {
      console.error('[HermesAPI] Failed to send message:', error);
      new Notice('Failed to send message. Check API settings.');
      return null;
    }
  }

  /**
   * Get API headers with authentication
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}
