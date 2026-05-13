import { Notice } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface HermesMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HermesRequest {
  messages: HermesMessage[];
  model?: string;
  context?: string;
  session_id?: string;
  stream?: boolean;
}

export interface HermesResponse {
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

export interface HermesSession {
  id: string;
  topic: string;
  messages: HermesMessage[];
  created_at: number;
  updated_at: number;
}

export class HermesAPI {
  private plugin: Plugin;
  private baseUrl: string;
  private apiKey: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.baseUrl = plugin.settings.hermesApiUrl || 'http://127.0.0.1:8642';
    this.apiKey = plugin.settings.hermesApiKey || '';
  }

  /**
   * Check if the Hermes API is reachable
   */
  public async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      return response.ok;
    } catch (error) {
      console.error('Hermes API connection check failed:', error);
      return false;
    }
  }

  /**
   * Create a new chat session
   */
  public async createSession(context?: string): Promise<HermesSession | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          context: context || ''
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from API');
      }
      const sessionData = data as Record<string, unknown>;
      return {
        id: sessionData['id'] as string,
        topic: sessionData['topic'] as string || 'New Conversation',
        messages: [],
        created_at: Date.now(),
        updated_at: Date.now()
      };
    } catch (error) {
      console.error('Failed to create session:', error);
      new Notice('Failed to create chat session. Check API settings.');
      return null;
    }
  }

  /**
   * Send a message to the Hermes API
   */
  public async sendMessage(
    sessionId: string,
    content: string,
    context?: string,
    model?: string
  ): Promise<HermesResponse | null> {
    try {
      const request: HermesRequest = {
        messages: [
          {
            role: 'user',
            content: content
          }
        ],
        model: model || this.plugin.settings.hermesAgentName,
        session_id: sessionId
      };

      // Add context if provided
      if (context) {
        request.context = context;
      }

      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const data = await response.json();
      return data as unknown as HermesResponse;
    } catch (error) {
      console.error('Failed to send message:', error);
      new Notice('Failed to send message. Check API settings.');
      return null;
    }
  }

  /**
   * Get all sessions
   */
  public async getSessions(): Promise<HermesSession[]> {
    try {
      const response = await fetch(`${this.baseUrl}/sessions`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to get sessions: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from API');
      }
      const sessionsData = data as Record<string, unknown>;
      return (sessionsData['sessions'] as HermesSession[]) || [];
    } catch (error) {
      console.error('Failed to get sessions:', error);
      return [];
    }
  }

  /**
   * Get a specific session by ID
   */
  public async getSession(sessionId: string): Promise<HermesSession | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to get session: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from API');
      }
      const sessionData = data as Record<string, unknown>;
      return {
        id: sessionData['id'] as string,
        topic: sessionData['topic'] as string || 'Conversation',
        messages: sessionData['messages'] as HermesMessage[] || [],
        created_at: sessionData['created_at'] as number || Date.now(),
        updated_at: sessionData['updated_at'] as number || Date.now()
      };
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Update a session
   */
  public async updateSession(sessionId: string, updates: Partial<HermesSession>): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify(updates)
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to update session:', error);
      return false;
    }
  }

  /**
   * Delete a session
   */
  public async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
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
