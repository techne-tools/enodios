import type { PromptContextItem } from './AcpClient.ts';

export interface ChatSessionUpdate {
  content?: string;
  reasoning?: string;
  stopReason?: string;
  toolCall?: {
    callId: string;
    name: string;
    status: 'running' | 'complete' | 'error';
    result?: string;
  };
  type: 'message' | 'reasoning' | 'tool_start' | 'tool_progress' | 'tool_complete' | 'usage' | 'stop' | 'available_commands';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  availableCommands?: Array<{ description: string; name: string }>;
}

export interface ChatClient {
  cancel(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  isReady(): boolean;
  onAvailableCommands(callback: (commands: Array<{ description: string; name: string }>) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onUpdate(callback: (update: ChatSessionUpdate) => void): () => void;
  sendPrompt(text: string, contextItems?: PromptContextItem[]): Promise<void>;
}
