import { existsSync } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { Notice, TFile } from 'obsidian';
import {
  ClientSideConnection,
  ndJsonStream,
  type Stream
} from '@agentclientprotocol/sdk';
import type {
  CancelNotification,
  Client,
  CloseSessionRequest,
  CreateTerminalRequest,
  CreateTerminalResponse,
  InitializeRequest,
  KillTerminalRequest,
  KillTerminalResponse,
  NewSessionRequest,
  PromptRequest,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse
} from '@agentclientprotocol/sdk';

import type { Plugin } from './Plugin.ts';
import type { ChatClient, ChatSessionUpdate } from './ChatClient.ts';

/**
 * Strip ANSI escape codes from a string.
 * Handles color codes, cursor movements, clear lines, and other terminal sequences.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][0-9;]*[^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()[\]{}#~%@\^=\/>!]/g, '') // Single-char escape sequences
    .replace(/\x1b\x1b/g, '');              // Double escapes
}

export interface AcpMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
  timestamp: number;
}

export interface AcpToolCall {
  args?: string;
  callId: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  result?: string;
}

export interface AcpSessionUpdate extends ChatSessionUpdate {
  toolCall?: AcpToolCall;
}

export interface PromptContextItem {
  id: string;
  text: string;
  type: 'folder' | 'note' | 'selection';
}

/**
 * Manages the ACP (Agent Client Protocol) connection to Hermes.
 * Spawns hermes acp as a subprocess and communicates via JSON-RPC over stdio.
 */
export class AcpClient implements ChatClient {
  private childProcess: ChildProcess | null = null;
  private clientConnection: ClientSideConnection | null = null;
  private currentSessionId: string | null = null;
  private isConnecting = false;
  private messageCallbacks: Array<(update: ChatSessionUpdate) => void> = [];
  private errorCallbacks: Array<(error: string) => void> = [];
  private commandsCallbacks: Array<(commands: Array<{ description: string; name: string }>) => void> = [];
  private lastAvailableCommands: Array<{ description: string; name: string }> = [];
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private resolveHermesPath(): string {
    const configuredPath = this.plugin.settings.hermesBinaryPath?.trim();
    if (configuredPath) {
      return configuredPath;
    }

    // Try common install locations
    const candidates = [
      '/Users/chris/.local/bin/hermes',
      '/usr/local/bin/hermes',
      '/opt/homebrew/bin/hermes',
      '/usr/bin/hermes'
    ];
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // Ignore
      }
    }

    return 'hermes';
  }

  /**
   * Check if the ACP client is connected and has an active session.
   */
  public isReady(): boolean {
    return this.childProcess !== null &&
      this.clientConnection !== null &&
      this.currentSessionId !== null &&
      !this.childProcess.killed;
  }

  /**
   * Spawn hermes acp and establish the ACP connection.
   */
  public async connect(): Promise<void> {
    if (this.isConnecting || this.isReady()) {
      return;
    }

    this.isConnecting = true;

    try {
      // Spawn hermes acp
      const hermesPath = this.resolveHermesPath();
      this.childProcess = spawn(hermesPath, ['acp'], {
        env: { ...process.env, ['PATH']: process.env['PATH'] ?? '' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!this.childProcess.stdin || !this.childProcess.stdout) {
        throw new Error('Failed to spawn hermes acp: stdio pipes not available');
      }

      // Log stderr for debugging only — Hermes outputs INFO/WARNING to stderr
      if (this.childProcess.stderr) {
        this.childProcess.stderr.on('data', (chunk: Buffer) => {
          const stderrText = stripAnsi(chunk.toString('utf-8').trim());
          if (stderrText) {
            // eslint-disable-next-line no-console
            console.log('[Hermes stderr]', stderrText);
          }
        });
      }

      // Convert Node.js streams to Web Streams
      const nodeReadable = this.childProcess.stdout;
      const nodeWritable = this.childProcess.stdin;

      const webReadable = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeReadable.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          nodeReadable.on('end', () => controller.close());
          nodeReadable.on('error', (err) => controller.error(err));
        }
      });

      const webWritable = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise((resolve, reject) => {
            nodeWritable.write(chunk, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      });

      // Create ndJson stream
      const stream: Stream = ndJsonStream(webWritable, webReadable);

      // Create client-side connection
      this.clientConnection = new ClientSideConnection(
        () => this.createClientHandler(),
        stream
      );

      // Initialize the connection
      const initRequest: InitializeRequest = {
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true
        },
        clientInfo: {
          name: 'obsidian-hermes',
          version: '0.0.0'
        },
        protocolVersion: 1
      };
      const initResponse = await this.clientConnection.initialize(initRequest);

      // ACP initialized successfully

      // Authenticate if needed
      if (initResponse.authMethods && initResponse.authMethods.length > 0) {
        const terminalMethod = initResponse.authMethods.find(
          (m) => m.id === 'hermes-setup'
        );
        if (terminalMethod) {
          await this.clientConnection.authenticate({
            methodId: 'hermes-setup'
          });
        }
      }

      // Create a new session
      const vaultPath = this.plugin.app.vault.getRoot().path;
      const sessionRequest: NewSessionRequest = {
        cwd: vaultPath,
        mcpServers: []
      };
      const sessionResponse = await this.clientConnection.newSession(sessionRequest);

      this.currentSessionId = sessionResponse.sessionId;
      // ACP session created successfully

      new Notice('Connected to Hermes via ACP');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`ACP connection failed: ${message}`);
      this.disconnect();
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from the ACP server and clean up resources.
   */
  public disconnect(): void {
    if (this.currentSessionId && this.clientConnection) {
      try {
        const closeRequest: CloseSessionRequest = {
          sessionId: this.currentSessionId
        };
        this.clientConnection.closeSession(closeRequest).catch(() => {
          // Ignore close errors
        });
      } catch {
        // Ignore
      }
    }

    this.currentSessionId = null;
    this.clientConnection = null;

    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');
      // Force kill after 2 seconds if still running
      window.setTimeout(() => {
        if (this.childProcess && !this.childProcess.killed) {
          this.childProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    this.childProcess = null;
  }

  /**
   * Send a prompt to the ACP session.
   */
  public async sendPrompt(text: string, contextItems: PromptContextItem[] = []): Promise<void> {
    if (!this.isReady() || !this.clientConnection || !this.currentSessionId) {
      throw new Error('ACP client not connected');
    }

    const promptBlocks: PromptRequest['prompt'] = [];

    // Add context items as embedded resources before the user message
    for (const item of contextItems) {
      if (item.type === 'note') {
        const notePath = item.id.replace(/^note-/, '');
        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
          if (file instanceof TFile) {
            const content = await this.plugin.app.vault.read(file);
            promptBlocks.push({
              resource: {
                mimeType: 'text/markdown',
                text: content,
                uri: `vault://${notePath}`
              },
              type: 'resource'
            });
          }
        } catch {
          // Skip notes that can't be read
        }
      } else if (item.type === 'selection') {
        promptBlocks.push({
          resource: {
            mimeType: 'text/plain',
            text: item.text,
            uri: `vault://selection/${encodeURIComponent(item.id)}`
          },
          type: 'resource'
        });
      }
      // folder type is skipped — no single file to embed
    }

    // Add the user's text message
    promptBlocks.push({
      text,
      type: 'text'
    });

    const promptRequest: PromptRequest = {
      prompt: promptBlocks,
      sessionId: this.currentSessionId
    };
    await this.clientConnection.prompt(promptRequest);
  }

  /**
   * Cancel the current prompt turn.
   */
  public async cancel(): Promise<void> {
    if (!this.isReady() || !this.clientConnection || !this.currentSessionId) {
      return;
    }

    const cancelNotification: CancelNotification = {
      sessionId: this.currentSessionId
    };
    await this.clientConnection.cancel(cancelNotification);
  }

  /**
   * Subscribe to session updates.
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
   * Subscribe to available commands updates from the agent.
   */
  public onAvailableCommands(callback: (commands: Array<{ description: string; name: string }>) => void): () => void {
    this.commandsCallbacks.push(callback);
    // Immediately notify with cached commands if available
    if (this.lastAvailableCommands.length > 0) {
      try {
        callback(this.lastAvailableCommands);
      } catch {
        // Ignore callback errors
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
   * Get the last known available commands from the agent.
   */
  public getLastAvailableCommands(): Array<{ description: string; name: string }> {
    return [...this.lastAvailableCommands];
  }

  private createClientHandler(): Client {
    return {
      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        // NOTE: Permissions are auto-approved. Future enhancement: show approval UI in Obsidian.
        const firstOption = params.options[0];
        if (firstOption) {
          return {
            outcome: 'selected' as const,
            optionId: firstOption.optionId
          } as unknown as RequestPermissionResponse;
        }
        return {
          outcome: 'cancelled' as const
        } as unknown as RequestPermissionResponse;
      },

      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        this.handleSessionUpdate(params);
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(params.path);
          if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${params.path}`);
          }
          const content = await this.plugin.app.vault.read(file);
          return { content };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to read file: ${message}`);
        }
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        try {
          const existingFile = this.plugin.app.vault.getAbstractFileByPath(params.path);
          if (existingFile instanceof TFile) {
            await this.plugin.app.vault.modify(existingFile, params.content);
          } else {
            await this.plugin.app.vault.create(params.path, params.content);
          }
          return {};
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to write file: ${message}`);
        }
      },

      createTerminal: async (_params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        // NOTE: Terminal support is not yet implemented.
        return {
          terminalId: `terminal-${Date.now()}`
        };
      },

      terminalOutput: async (_params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
        return {
          exitStatus: { exitCode: 0, signal: null },
          output: '',
          truncated: false
        };
      },

      releaseTerminal: async (_params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse | void> => {
        return {};
      },

      waitForTerminalExit: async (_params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
        return {
          exitCode: 0,
          signal: null
        };
      },

      killTerminal: async (_params: KillTerminalRequest): Promise<KillTerminalResponse | void> => {
        return {};
      }
    };
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const parsedUpdate = this.parseUpdate(notification);
    if (parsedUpdate) {
      for (const callback of this.messageCallbacks) {
        try {
          callback(parsedUpdate);
        } catch {
          // Ignore callback errors
        }
      }

      // Also notify command subscribers when available_commands update arrives
      if (parsedUpdate.type === 'available_commands' && parsedUpdate.availableCommands) {
        this.lastAvailableCommands = parsedUpdate.availableCommands;
        for (const callback of this.commandsCallbacks) {
          try {
            callback(parsedUpdate.availableCommands);
          } catch {
            // Ignore callback errors
          }
        }
      }
    }
  }

  private parseUpdate(notification: SessionNotification): AcpSessionUpdate | null {
    const update = notification.update;

    // Content chunks (message streaming)
    if ('sessionUpdate' in update) {
      if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'user_message_chunk') {
        const chunk = update as { content?: { type: string; text?: string } };
        if (chunk.content && chunk.content.type === 'text' && typeof chunk.content.text === 'string') {
          return {
            content: chunk.content.text,
            type: 'message'
          };
        }
      }

      // Tool call updates
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const toolUpdate = update as {
          status?: string;
          title?: string;
          toolCallId?: string;
        };
        const statusMap: Record<string, 'running' | 'complete' | 'error'> = {
          'pending': 'running',
          'in_progress': 'running',
          'completed': 'complete',
          'failed': 'error'
        };
        return {
          toolCall: {
            callId: String(toolUpdate.toolCallId ?? ''),
            name: String(toolUpdate.title ?? ''),
            status: statusMap[toolUpdate.status ?? ''] ?? 'running'
          },
          type: update.sessionUpdate === 'tool_call_update' ? 'tool_progress' : 'tool_start'
        };
      }

      // Available commands update (Hermes tools/plugins)
      if (update.sessionUpdate === 'available_commands_update') {
        const commandsUpdate = update as { availableCommands?: Array<{ description: string; name: string }> };
        if (commandsUpdate.availableCommands) {
          return {
            availableCommands: commandsUpdate.availableCommands,
            type: 'available_commands'
          };
        }
      }

      // Usage updates
      if (update.sessionUpdate === 'usage_update') {
        const usageUpdate = update as { size?: number; used?: number };
        return {
          type: 'usage',
          usage: {
            inputTokens: Number(usageUpdate.used ?? 0),
            outputTokens: 0,
            totalTokens: Number(usageUpdate.size ?? 0)
          }
        };
      }
    }

    return null;
  }
}
