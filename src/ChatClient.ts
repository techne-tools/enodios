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
  type: 'message' | 'reasoning' | 'tool_start' | 'tool_progress' | 'tool_complete' | 'usage' | 'stop' | 'available_commands' | 'terminal_output';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  availableCommands?: Array<{ description: string; name: string }>;
  terminal?: {
    id: string;
    output: string;
    isExited?: boolean;
  };
}

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ChatClient {
  abortTerminal?(terminalId: string): void;
  cancel(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  getConnectionState?(): { isReconnecting: boolean; reconnectAttempt: number; maxAttempts: number };
  isReady(): boolean;
  onAvailableCommands(callback: (commands: Array<{ description: string; name: string }>) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onUpdate(callback: (update: ChatSessionUpdate) => void): () => void;
  sendPrompt(text: string, contextItems?: PromptContextItem[], options?: { allowedTools?: string[] | null }): Promise<void>;
}
