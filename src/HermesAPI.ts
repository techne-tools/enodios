import { Notice } from 'obsidian';

import type { Plugin } from './Plugin.ts';

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

export class HermesAPI {
  private apiKey: string;
  private baseUrl: string;
  private plugin: Plugin;

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
            headers: this.getHeaders(),
            method: 'GET'
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
    stream = false
  ): Promise<HermesChatResponse | null> {
    try {
      const request: HermesChatRequest = {
        messages,
        model: model || this.plugin.settings.hermesAgentName,
        stream
      };

      console.log('[HermesAPI] Sending message to', `${this.baseUrl}/v1/chat/completions`);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        body: JSON.stringify(request),
        headers: this.getHeaders(),
        method: 'POST'
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
    store = true
  ): Promise<HermesResponseAPI | null> {
    try {
      const request: HermesResponseRequest = {
        input,
        model: model || this.plugin.settings.hermesAgentName,
        store
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
        body: JSON.stringify(request),
        headers: this.getHeaders(),
        method: 'POST'
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
