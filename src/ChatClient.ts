import type { PromptContextItem } from './AcpClient.ts';

export interface ChatClient {
  abortTerminal?(terminalId: string): void;
  cancel(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): void;
  getConnectionState?(): { isReconnecting: boolean; maxAttempts: number; reconnectAttempt: number };
  isReady(): boolean;
  onAvailableCommands(callback: (commands: { description: string; name: string }[]) => void): () => void;
  onError(callback: (error: string) => void): () => void;
  onUpdate(callback: (update: ChatSessionUpdate) => void): () => void;
  sendPrompt(text: string, contextItems?: PromptContextItem[], options?: { allowedTools?: null | string[] }): Promise<void>;
}

export interface ChatSessionUpdate {
  availableCommands?: { description: string; name: string }[];
  content?: string;
  reasoning?: string;
  stopReason?: string;
  terminal?: {
    id: string;
    isExited?: boolean;
    output: string;
  };
  toolCall?: {
    callId: string;
    name: string;
    result?: string;
    status: 'complete' | 'error' | 'running';
  };
  type: 'available_commands' | 'message' | 'reasoning' | 'stop' | 'terminal_output' | 'tool_complete' | 'tool_progress' | 'tool_start' | 'usage';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface TokenUsageStats {
  estimatedCost: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
