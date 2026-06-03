import type { PromptContextItem } from './AcpClient.ts';

/**
 * Common interface for both ACP and API chat backends.
 *
 * ARCHITECTURAL ROLE:
 * This interface is the "seam" that lets the Plugin class and the UI
 * treat AcpClient and HermesApiClient interchangeably. Without this,
 * every consumer would need conditional logic like:
 *   if (mode === 'acp') { acpClient.send(...) } else { apiClient.send(...) }
 *
 * DESIGN DECISIONS:
 * - All methods are async (return Promise) so both backends can perform
 *   I/O without blocking the UI thread.
 * - Optional methods (e.g. `abortTerminal`, `getConnectionState`) use
 *   `?` because the API client genuinely cannot abort remote terminals.
 * - The `onUpdate` callback pattern (returning an unsubscribe function)
 *   is chosen over EventEmitter because it avoids memory leaks when
 *   React components mount/unmount frequently.
 * - `cancel()` is separate from `disconnect()` because cancel only stops
 *   the current prompt turn, while disconnect tears down the entire session.
 */
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
    result?: string | undefined;
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
