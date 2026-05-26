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
  Stream,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse
} from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'child_process';

import {
  ClientSideConnection,
  ndJsonStream
} from '@agentclientprotocol/sdk';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import {
 normalizePath,
Notice,
TFile
} from 'obsidian';

import type {
 ChatClient,
ChatSessionUpdate
} from './ChatClient.ts';
import type { Plugin } from './Plugin.ts';

import { generateMessageId } from './utils/uuid.ts';

const MAX_TERMINAL_OUTPUT = 1024 * 1024; // 1MB cap on terminal output to prevent memory exhaustion

const ALLOWED_SHELL_COMMANDS = new Set([
  'cat', 'cp', 'curl', 'echo', 'find', 'git', 'grep', 'ls', 'mkdir', 'mv', 'rm', 'touch', 'wget'
]);

// Argument patterns that enable arbitrary code execution even in "safe" commands
const DANGEROUS_ARG_PATTERNS = [
  '-c', '--command', '-e', '--eval', '-exec',
  '|', ';', '&&', '||', '$(', '`', '${', '>>', '<('
];

export interface AcpMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
  timestamp: number;
}

export interface AcpSessionUpdate extends ChatSessionUpdate {
  toolCall?: AcpToolCall;
}

export interface AcpToolCall {
  args?: string;
  callId: string;
  name: string;
  result?: string;
  status: 'complete' | 'error' | 'running';
}

export interface ActiveTerminal {
  exitCode: null | number;
  id: string;
  output: string;
  process: ChildProcess;
  signal: null | string;
}

export interface PendingPermission {
  id: string;
  params: RequestPermissionRequest;
  reject: (error: Error) => void;
  resolve: (response: RequestPermissionResponse) => void;
}

export interface PromptContextItem {
  data?: string;
  id: string;
  mimeType?: string;
  text: string;
  type: 'folder' | 'image' | 'note' | 'pdf' | 'selection';
}

/**
 * Manages the ACP (Agent Client Protocol) connection to Hermes.
 * Spawns hermes acp as a subprocess and communicates via JSON-RPC over stdio.
 */
export class AcpClient implements ChatClient {
  private activeTerminals = new Map<string, ActiveTerminal>();
  private readonly BASE_RECONNECT_DELAY_MS = 1000;
  private childProcess: ChildProcess | null = null;
  private clientConnection: ClientSideConnection | null = null;
  private commandsCallbacks: ((commands: { description: string; name: string }[]) => void)[] = [];
  private connectPromise: null | Promise<void> = null;
  private currentAllowedTools: null | string[] = null;
  private currentSessionId: null | string = null;
  private disconnectKillTimeout: null | ReturnType<typeof setTimeout> = null;
  private errorCallbacks: ((error: string) => void)[] = [];
  private isReconnecting = false;
  private lastAvailableCommands: { description: string; name: string }[] = [];
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly MAX_RECONNECT_DELAY_MS = 30000;
  private messageCallbacks: ((update: ChatSessionUpdate) => void)[] = [];
  private pendingPermissions: PendingPermission[] = [];
  private permissionCallbacks: ((permissions: PendingPermission[]) => void)[] = [];

  private readonly plugin: Plugin;
  // Auto-reconnection state
  private reconnectAttempts = 0;
  private reconnectTimeout: null | ReturnType<typeof setTimeout> = null;
  private stderrHandler: ((chunk: Buffer) => void) | null = null;
  private webReadable: null | ReadableStream<Uint8Array> = null;
  private webWritable: null | WritableStream<Uint8Array> = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  public abortTerminal(terminalId: string): void {
    const terminal = this.activeTerminals.get(terminalId);
    if (terminal && !terminal.process.killed && terminal.exitCode === null) {
      terminal.process.kill('SIGINT');
      this.emitUpdate({
        terminal: { id: terminalId, isExited: true, output: '\n[Process aborted by user]\n' },
        type: 'terminal_output'
      });
    }
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
   * Reject/cancel all pending permission requests.
   */
  public cancelAllPermissions(): void {
    if (this.pendingPermissions.length === 0) { return; }

    const pending = [...this.pendingPermissions];
    this.pendingPermissions = [];
    for (const p of pending) {
      const permType = String((p.params as unknown as Record<string, unknown>)['permissionType'] || 'permission');
      this.plugin.auditLog.recordPermission(permType, 'cancelled', 'failure');
      p.resolve({ outcome: 'cancelled' } as unknown as RequestPermissionResponse);
    }
    this.notifyPermissions();
  }

  /**
   * Reject/cancel a pending permission by ID.
   */
  public cancelPermission(permissionId: string): void {
    const pending = this.pendingPermissions.find((p) => p.id === permissionId);
    if (pending) {
      const permType = String((pending.params as unknown as Record<string, unknown>)['permissionType'] || 'permission');
      this.plugin.auditLog.recordPermission(permType, 'cancelled', 'failure');
      pending.resolve({
        outcome: 'cancelled'
      } as unknown as RequestPermissionResponse);
      this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== permissionId);
      this.notifyPermissions();
    }
  }

  /**
   * Cancel any pending reconnection.
   */
  public cancelReconnect(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Spawn hermes acp and establish the ACP connection.
   */
  public async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.isReady()) {
      return;
    }

    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  public disconnect(): void {
    // Cancel any pending auto-reconnect
    this.cancelReconnect();

    // Kill all active terminals
    for (const terminal of this.activeTerminals.values()) {
      if (!terminal.process.killed && terminal.exitCode === null) {
        terminal.process.kill('SIGKILL');
      }
    }
    this.activeTerminals.clear();

    // Reject all pending permissions
    for (const pending of this.pendingPermissions) {
      pending.reject(new Error('Connection closed'));
    }
    this.pendingPermissions = [];
    this.notifyPermissions();

    // Cancel web streams
    if (this.webReadable) {
      this.webReadable.cancel().catch(() => {});
      this.webReadable = null;
    }
    this.webWritable = null;

    // Remove stderr listener
    if (this.childProcess?.stderr && this.stderrHandler) {
      this.childProcess.stderr.off('data', this.stderrHandler);
      this.stderrHandler = null;
    }

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

    if (this.disconnectKillTimeout) {
      clearTimeout(this.disconnectKillTimeout);
      this.disconnectKillTimeout = null;
    }

    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');
      // Force kill after 2 seconds if still running
      this.disconnectKillTimeout = setTimeout(() => {
        if (this.childProcess && !this.childProcess.killed) {
          this.childProcess.kill('SIGKILL');
        }
      }, 2000);
    }

    this.childProcess = null;
  }

  /**
   * Get current reconnection state for UI display.
   */
  public getConnectionState(): { isReconnecting: boolean; maxAttempts: number; reconnectAttempt: number } {
    return {
      isReconnecting: this.isReconnecting,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      reconnectAttempt: this.reconnectAttempts
    };
  }

  /**
   * Get the last known available commands from the agent.
   */
  public getLastAvailableCommands(): { description: string; name: string }[] {
    return [...this.lastAvailableCommands];
  }

  /**
   * Get all pending permission requests.
   */
  public getPendingPermissions(): PendingPermission[] {
    return [...this.pendingPermissions];
  }

  /**
   * Check if the ACP client is connected and has an active session.
   */
  public isReady(): boolean {
    return this.childProcess !== null
      && this.clientConnection !== null
      && this.currentSessionId !== null
      && !this.childProcess.killed;
  }

  /**
   * Subscribe to available commands updates from the agent.
   */
  public onAvailableCommands(callback: (commands: { description: string; name: string }[]) => void): () => void {
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
   * Subscribe to pending permission requests.
   */
  public onPermissionsChange(callback: (permissions: PendingPermission[]) => void): () => void {
    this.permissionCallbacks.push(callback);
    callback(this.getPendingPermissions()); // Immediately notify with current state
    return () => {
      const index = this.permissionCallbacks.indexOf(callback);
      if (index >= 0) {
        this.permissionCallbacks.splice(index, 1);
      }
    };
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
   * Resolve all pending permission requests with the first available "allow" option.
   */
  public resolveAllPermissions(): void {
    if (this.pendingPermissions.length === 0) { return; }

    const pending = [...this.pendingPermissions];
    this.pendingPermissions = [];
    for (const p of pending) {
      const options = p.params.options ?? [];
      const allowOptions = options.filter((o: Record<string, unknown>) => String(o['kind']).startsWith('allow_'));
      const permType = String((p.params as unknown as Record<string, unknown>)['permissionType'] || 'permission');

      // SECURITY: Only auto-approve permissions that have exactly one option
      // and that option is an allow. Permissions with multiple options (or a mix
      // of allow/deny) require explicit per-permission review to prevent
      // accidental approval of dangerous actions.
      if (allowOptions.length === 1 && options.length === 1) {
        const outcome = String(allowOptions[0]!.kind || allowOptions[0]!.optionId);
        this.plugin.auditLog.recordPermission(permType, outcome, 'success');
        p.resolve({
          optionId: String(allowOptions[0]!.optionId),
          outcome: 'selected'
        } as unknown as RequestPermissionResponse);
      } else {
        this.plugin.auditLog.recordPermission(permType, 'cancelled', 'failure');
        p.resolve({ outcome: 'cancelled' } as unknown as RequestPermissionResponse);
      }
    }
    this.notifyPermissions();
  }

  /**
   * Resolve a pending permission by ID.
   */
  public resolvePermission(permissionId: string, optionId: string): void {
    const pending = this.pendingPermissions.find((p) => p.id === permissionId);
    if (pending) {
      const option = pending.params.options?.find((o: Record<string, unknown>) => String(o['optionId']) === optionId);
      const outcome = option ? String(option.kind || optionId) : optionId;
      const permType = String((pending.params as unknown as Record<string, unknown>)['permissionType'] || 'permission');
      this.plugin.auditLog.recordPermission(permType, outcome, 'success');
      pending.resolve({
        optionId,
        outcome: 'selected'
      } as unknown as RequestPermissionResponse);
      this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== permissionId);
      this.notifyPermissions();
    }
  }

  /**
   * Send a prompt to the ACP session.
   */
  public async sendPrompt(text: string, contextItems: PromptContextItem[] = [], options?: { allowedTools?: null | string[] }): Promise<void> {
    this.currentAllowedTools = options?.allowedTools ?? null;
    if (!this.isReady() || !this.clientConnection || !this.currentSessionId) {
      throw new Error('ACP client not connected');
    }

    const promptBlocks: PromptRequest['prompt'] = [];

    // Inject active persona system prompt
    const activePersona = this.plugin.settings.personaTemplates.find(
      (p) => p.id === this.plugin.settings.activePersonaId
    );
    if (activePersona?.systemPrompt) {
      promptBlocks.push({
        text: activePersona.systemPrompt,
        type: 'text'
      });
    }

    // Add context items as embedded resources before the user message
    for (const item of contextItems) {
      if (item.type === 'note') {
        const notePath = item.id.replace(/^note-/, '');
        // Handle block references: block-{path}-{startLine}
        const blockMatch = /^block-(.+)-(\d+)$/.exec(item.id);
        try {
          if (blockMatch) {
            const blockPath = blockMatch[1]!;
            const startLine = parseInt(blockMatch[2]!, 10);
            const file = this.plugin.app.vault.getAbstractFileByPath(blockPath);
            if (file instanceof TFile) {
              const content = await this.plugin.app.vault.read(file);
              const lines = content.split('\n');
              // Find the block containing this start line
              const { parseBlockReferences } = await import('./utils/blockReferences.ts');
              const blocks = parseBlockReferences(content);
              const block = blocks.find((b) => b.startLine === startLine);
              if (block) {
                promptBlocks.push({
                  resource: {
                    mimeType: 'text/markdown',
                    text: `--- Block from ${blockPath} (${block.type}) ---\n${block.content}`,
                    uri: `vault://${blockPath}#block-${startLine}`
                  },
                  type: 'resource'
                });
              } else {
                // Fallback: just include the single line
                promptBlocks.push({
                  resource: {
                    mimeType: 'text/markdown',
                    text: lines[startLine] ?? '',
                    uri: `vault://${blockPath}#L${startLine}`
                  },
                  type: 'resource'
                });
              }
            }
          } else {
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
      } else if ((item.type === 'image' || item.type === 'pdf') && item.data) {
        promptBlocks.push({
          resource: {
            blob: item.data,
            mimeType: item.mimeType ?? (item.type === 'pdf' ? 'application/pdf' : 'image/jpeg'),
            uri: `data:${item.mimeType ?? (item.type === 'pdf' ? 'application/pdf' : 'image/jpeg')};base64,${item.data}`
          },
          type: 'resource'
        });
      }
      // Folder type is skipped — no single file to embed
    }

    // Add the user's text message
    promptBlocks.push({
      text,
      type: 'text'
    });

    if (this.currentAllowedTools) {
      promptBlocks.push({
        text: `System Instruction: For this session, you are ONLY permitted to use the following tools: ${this.currentAllowedTools.join(', ')}. Do not attempt to use any other tools.`,
        type: 'text'
      });
    }

    const promptRequest: PromptRequest = {
      prompt: promptBlocks,
      sessionId: this.currentSessionId
    };
    await this.clientConnection.prompt(promptRequest);
  }

  private checkToolAllowed(toolName: string): void {
    if (this.currentAllowedTools !== null && !this.currentAllowedTools.includes(toolName)) {
      throw new Error(`Tool execution rejected: '${toolName}' is disabled for this specific chat session.`);
    }
  }

  private createClientHandler(): Client {
    return {
      createTerminal: async (params: { arguments?: string[]; command?: string } & CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        this.checkToolAllowed('createTerminal');
        if (!this.plugin.settings.allowTerminal) {
          this.plugin.auditLog.recordTerminal(params.command || 'bash', 'blocked');
          throw new Error('Terminal access is disabled in Hermes settings. Enable "Allow Terminal Access" to use terminal tools.');
        }

        const terminalId = `terminal-${Date.now()}`;
        const rawCommand = params.command || (process.platform === 'win32' ? 'cmd.exe' : 'bash');
        const args = params.arguments || [];

        // SECURITY: Sanitize the command to prevent injection.
        // We only allow known-safe base commands and reject shell metacharacters.
        const command = sanitizeShellCommand(rawCommand);

        const child = spawn(command, args, {
          cwd: this.plugin.app.vault.getRoot().path,
          env: { ...process.env, PATH: process.env['PATH'] ?? '' },
          shell: false // Shell: false is required for security — we pass args directly
        });

        const terminal: ActiveTerminal = {
          exitCode: null,
          id: terminalId,
          output: '',
          process: child,
          signal: null
        };

        const appendOutput = (text: string): void => {
          if (terminal.output.length + text.length > MAX_TERMINAL_OUTPUT) {
            const keep = MAX_TERMINAL_OUTPUT - text.length - 100;
            if (keep > 0) {
              terminal.output = terminal.output.slice(-keep) + text;
            } else {
              terminal.output = text.slice(-MAX_TERMINAL_OUTPUT);
            }
          } else {
            terminal.output += text;
          }
        };

        child.stdout?.on('data', (data) => {
          const text = data.toString();
          appendOutput(text);
          this.emitUpdate({ terminal: { id: terminalId, output: text }, type: 'terminal_output' });
        });

        child.stderr?.on('data', (data) => {
          const text = data.toString();
          appendOutput(text);
          this.emitUpdate({ terminal: { id: terminalId, output: text }, type: 'terminal_output' });
        });

        child.on('close', (code, signal) => {
          terminal.exitCode = code;
          terminal.signal = signal;
          const exitMsg = `\n[Process exited with code ${code ?? signal}]\n`;
          appendOutput(exitMsg);
          this.emitUpdate({ terminal: { id: terminalId, isExited: true, output: exitMsg }, type: 'terminal_output' });
          this.plugin.auditLog.recordTerminal(`${command} ${args.join(' ')}`, code === 0 ? 'success' : 'failure', code);

          // Self-cleanup after 60 seconds to prevent memory leaks if agent forgets to release
          setTimeout(() => {
            this.activeTerminals.delete(terminalId);
          }, 60000);
        });

        this.activeTerminals.set(terminalId, terminal);
        this.plugin.auditLog.recordTerminal(`${command} ${args.join(' ')}`, 'success');

        return {
          terminalId
        };
      },

      killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse | void> => {
        const terminal = this.activeTerminals.get(params.terminalId);
        if (terminal && !terminal.process.killed && terminal.exitCode === null) {
          terminal.process.kill('SIGINT');
        }
        return {};
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        this.checkToolAllowed('readTextFile');

        if (!isPathSafe(params.path)) {
          this.plugin.auditLog.recordToolCall('readTextFile', { path: params.path }, 'blocked', 'Path traversal denied');
          throw new Error(`Path traversal denied: ${params.path}`);
        }
        const normalized = normalizePath(params.path);

        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(normalized);
          if (!(file instanceof TFile)) {
            this.plugin.auditLog.recordToolCall('readTextFile', { path: params.path }, 'failure', 'File not found');
            throw new Error(`File not found: ${params.path}`);
          }
          const content = await this.plugin.app.vault.read(file);
          this.plugin.auditLog.recordToolCall('readTextFile', { path: params.path }, 'success');
          return { content };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.auditLog.recordToolCall('readTextFile', { path: params.path }, 'failure', message);
          throw new Error(`Failed to read file: ${message}`);
        }
      },

      releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse | void> => {
        const terminal = this.activeTerminals.get(params.terminalId);
        if (terminal) {
          if (!terminal.process.killed && terminal.exitCode === null) {
            terminal.process.kill('SIGKILL');
          }
          this.activeTerminals.delete(params.terminalId);
        }
        return {};
      },

      requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        return new Promise((resolve, reject) => {
          const pending: PendingPermission = {
            id: generateMessageId(),
            params,
            reject,
            resolve
          };
          this.pendingPermissions.push(pending);
          this.notifyPermissions();
        });
      },

      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        this.handleSessionUpdate(params);
      },

      terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
        const terminal = this.activeTerminals.get(params.terminalId);
        if (!terminal) {
          throw new Error(`Terminal not found: ${params.terminalId}`);
        }

        const exitStatus = (terminal.exitCode !== null || terminal.signal !== null)
          ? { exitCode: terminal.exitCode ?? 0, signal: terminal.signal ?? null }
          : undefined;

        return {
          ...(exitStatus ? { exitStatus } : {}),
          output: terminal.output,
          truncated: false
        };
      },

      waitForTerminalExit: async (params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
        const terminal = this.activeTerminals.get(params.terminalId);
        if (!terminal) { throw new Error(`Terminal not found: ${params.terminalId}`); }
        if (terminal.exitCode !== null || terminal.signal !== null) { return { exitCode: terminal.exitCode ?? 0, signal: terminal.signal ?? null }; }
        return new Promise((resolve) => {
          terminal.process.once('close', (code, signal) => { resolve({ exitCode: code ?? 0, signal: signal ?? null }); });
        });
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        // SECURITY: Session-level tool restrictions apply BEFORE queuing.
        // FileChangeManager provides a second gate (user approval) but does not
        // replace session-level blocking. A tool disabled in session settings
        // must be rejected immediately, not merely queued for approval.
        this.checkToolAllowed('writeTextFile');
        try {
          // Queue the change for user approval instead of writing immediately
          await this.plugin.fileChangeManager.registerChange(params.path, params.content);
          this.plugin.auditLog.recordFileChange(params.path, params.content === null ? 'delete' : 'modify', 'pending');
          return {};
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.auditLog.recordToolCall('writeTextFile', { path: params.path }, 'failure', message);
          throw new Error(`Failed to queue file change: ${message}`);
        }
      }
    };
  }

  private async doConnect(): Promise<void> {
    try {
      // Spawn hermes acp
      const hermesPath = this.resolveHermesPath();
      this.childProcess = spawn(hermesPath, ['acp'], {
        env: { ...process.env, PATH: process.env['PATH'] ?? '' },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      if (!this.childProcess.stdin || !this.childProcess.stdout) {
        throw new Error('Failed to spawn hermes acp: stdio pipes not available');
      }

      // Log stderr for debugging only — Hermes outputs INFO/WARNING to stderr
      if (this.childProcess.stderr) {
        this.stderrHandler = (chunk: Buffer) => {
          const stderrText = stripAnsi(chunk.toString('utf-8').trim());
          if (stderrText) {
            this.plugin.debug.debug('Agent stderr', stderrText);
          }
        };
        this.childProcess.stderr.on('data', this.stderrHandler);
      }

      // Handle spawn errors (e.g., binary not found)
      this.childProcess.on('error', (err) => {
        this.plugin.debug.error('ACP child process error', err);
        this.plugin.auditLog.recordConnection('connect', 'acp', 'failure', err.message);
        this.scheduleReconnect();
      });

      // Handle unexpected child process exit
      this.childProcess.on('close', (code, signal) => {
        if (code !== null || signal !== null) {
          this.plugin.debug.error('ACP child process exited', { code, signal });
          this.plugin.auditLog.recordConnection('disconnect', 'acp', 'failure', `exit code ${code}, signal ${signal}`);
          this.scheduleReconnect();
        }
      });

      // Convert Node.js streams to Web Streams
      const nodeReadable = this.childProcess.stdout;
      const nodeWritable = this.childProcess.stdin;

      this.webReadable = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeReadable.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk));
          });
          nodeReadable.on('end', () => { controller.close(); });
          nodeReadable.on('error', (err) => { controller.error(err); });
        }
      });

      this.webWritable = new WritableStream<Uint8Array>({
        write(chunk) {
          return new Promise((resolve, reject) => {
            nodeWritable.write(chunk, (err) => {
              if (err) { reject(err); } else { resolve(); }
            });
          });
        }
      });

      // Create ndJson stream
      const stream: Stream = ndJsonStream(this.webWritable, this.webReadable);

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

      let mcpServers: string[] = [];
      if (this.plugin.settings.mcpServersEnabled) {
        mcpServers = this.plugin.settings.mcpServersList
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (mcpServers.length > 0) {
          this.plugin.auditLog.recordConnection('mcp_servers', 'acp', 'success', `enabled with ${mcpServers.length} server(s)`);
        }
      } else {
        this.plugin.auditLog.recordConnection('mcp_servers', 'acp', 'blocked', 'disabled by user setting');
      }

      // Security Note: MCP servers are external executables spawned by the Hermes agent.
      // Configuring untrusted MCP servers poses a significant security risk, as they can
      // Execute arbitrary code on the user's system with the privileges of the Obsidian process.
      // Users must be warned about this risk in the plugin documentation.

      const sessionRequest: NewSessionRequest = {
        cwd: vaultPath,
        mcpServers: mcpServers as unknown as NewSessionRequest['mcpServers']
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
    }
  }

  private emitUpdate(update: ChatSessionUpdate): void {
    for (const callback of this.messageCallbacks) {
      try { callback(update); } catch {}
    }

    // Dispatch usage events to window for the TokenUsageFooter component
    if (update.type === 'usage' && update.usage) {
      const estimatedCost = (update.usage.inputTokens * 0.000003) + (update.usage.outputTokens * 0.000015); // Approximate GPT-4 pricing
      window.dispatchEvent(new CustomEvent('hermes-usage-update', {
        detail: {
          estimatedCost,
          inputTokens: update.usage.inputTokens,
          outputTokens: update.usage.outputTokens,
          totalTokens: update.usage.totalTokens
        }
      }));
    }
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const parsedUpdate = this.parseUpdate(notification);
    if (parsedUpdate) {
      this.emitUpdate(parsedUpdate);

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

  private notifyPermissions(): void {
    const current = this.getPendingPermissions();
    for (const callback of this.permissionCallbacks) {
      try {
        callback(current);
      } catch {}
    }
  }

  private parseUpdate(notification: SessionNotification): AcpSessionUpdate | null {
    const update = notification.update;

    // Content chunks (message streaming)
    if ('sessionUpdate' in update) {
      if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'user_message_chunk') {
        const chunk = update as { content?: { text?: string; type: string } };
        if (chunk.content?.type === 'text' && typeof chunk.content.text === 'string') {
          return {
            content: chunk.content.text,
            type: 'message'
          };
        }
      }

      // Reasoning chunks
      if (update.sessionUpdate === 'agent_thought_chunk') {
        const chunk = update as { content?: { text?: string; type: string } };
        if (chunk.content?.type === 'text' && typeof chunk.content.text === 'string') {
          return {
            reasoning: chunk.content.text,
            type: 'reasoning'
          };
        }
      }

      // Tool call updates
      if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
        const toolUpdate = update as {
          name?: string;
          result?: unknown;
          status?: string;
          title?: string;
          tool?: { name?: string };
          toolCall?: { name?: string };
          toolCallId?: string;
          toolName?: string;
        };
        const statusMap: Record<string, 'complete' | 'error' | 'running'> = {
          completed: 'complete',
          failed: 'error',
          in_progress: 'running',
          pending: 'running'
        };

        const status = statusMap[toolUpdate.status ?? ''] ?? 'running';
        const resultStr = toolUpdate.result !== undefined
          ? (typeof toolUpdate.result === 'string' ? toolUpdate.result : JSON.stringify(toolUpdate.result, null, 2))
          : undefined;

        // The ACP protocol may send the tool name in various locations depending on version.
        // Check all known locations: name, title, toolCall.name, tool.name, toolName.
        // Also check nested content fields used by some ACP server implementations.
        const rawUpdate = update as unknown as Record<string, unknown>;
        const contentObj = rawUpdate['content'] as Record<string, unknown> | undefined;
        const contentTool = contentObj?.['tool'] as Record<string, string> | undefined;
        const contentToolCall = contentObj?.['toolCall'] as Record<string, string> | undefined;
        const toolName = toolUpdate.name
          ?? toolUpdate.title
          ?? toolUpdate.toolCall?.name
          ?? toolUpdate.tool?.name
          ?? toolUpdate.toolName
          ?? contentTool?.['name']
          ?? contentObj?.['name'] as string | undefined
          ?? contentToolCall?.['name']
          ?? 'unknown-tool';

        const toolCall: AcpToolCall = {
          callId: String(toolUpdate.toolCallId ?? ''),
          name: String(toolName),
          status
        };
        if (resultStr !== undefined) {
          toolCall.result = resultStr;
        }

        return {
          toolCall,
          type: status === 'complete' || status === 'error' ? 'tool_complete' : (update.sessionUpdate === 'tool_call_update' ? 'tool_progress' : 'tool_start')
        };
      }

      // Available commands update (Hermes tools/plugins)
      if (update.sessionUpdate === 'available_commands_update') {
        const commandsUpdate = update as { availableCommands?: { description: string; name: string }[] };
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

  private resolveHermesPath(): string {
    const configuredPath = this.plugin.settings.hermesBinaryPath?.trim();
    if (configuredPath) {
      return configuredPath;
    }

    // Try common install locations
    const candidates = [
      `${process.env['HOME'] ?? ''}/.local/bin/hermes`,
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
   * Schedule an automatic reconnection with exponential backoff.
   */
  private scheduleReconnect(): void {
    if (this.isReconnecting) { return; }
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.emitUpdate({ content: '🔌 ACP connection lost. Max reconnection attempts reached. Please reconnect manually.', type: 'message' });
      this.plugin.auditLog.recordConnection('reconnect', 'acp', 'failure', 'Max reconnection attempts reached');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      this.MAX_RECONNECT_DELAY_MS
    );

    this.emitUpdate({
      content: `🔌 Reconnecting to Hermes (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`,
      type: 'message'
    });
    this.plugin.auditLog.recordConnection('reconnect', 'acp', 'pending', `attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect()
        .then(() => {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.plugin.auditLog.recordConnection('reconnect', 'acp', 'success');
        })
        .catch(() => {
          this.isReconnecting = false;
          this.scheduleReconnect();
        });
    }, delay);
  }
}

/**
 * Strengthened path traversal check.
 * Rejects absolute paths, parent-directory traversal, null bytes, control
 * characters, and Windows drive-letter paths.
 */
function isPathSafe(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (normalized.startsWith('..') || normalized.startsWith('/') || normalized.includes('../')) {
    return false;
  }
  // Reject null bytes and control characters
  if (/[\x00-\x1f]/.test(normalized)) {
    return false;
  }
  // Reject Windows absolute paths
  if (/^[a-zA-Z]:[\\\/]/.test(normalized)) {
    return false;
  }
  return true;
}

/**
 * Sanitize a shell command to prevent command injection.
 * Only allows known safe commands; rejects metacharacters and dangerous arguments.
 *
 * SECURITY NOTE: This is a speed bump, not a guarantee. The allowlist excludes
 * all shells and script interpreters (bash, python, node, etc.) because they
 * execute arbitrary code by design. Remaining utilities are checked for
 * dangerous argument patterns that could enable injection (pipes, redirects,
 * command substitution, etc.).
 */
function sanitizeShellCommand(command: string): string {
  const trimmed = command.trim();
  // Extract the base command (first token before any whitespace)
  const baseMatch = /^([a-zA-Z0-9_\-\.]+)/.exec(trimmed);
  const base = baseMatch?.[1] ?? '';

  if (!ALLOWED_SHELL_COMMANDS.has(base.toLowerCase())) {
    throw new Error(`Disallowed shell command: ${base}. Terminal access is restricted to standard file and network utilities. Shells and script interpreters are not permitted.`);
  }

  // Validate arguments for dangerous patterns that enable arbitrary code execution
  const argsString = trimmed.slice(base.length).trim();
  if (argsString) {
    for (const pattern of DANGEROUS_ARG_PATTERNS) {
      if (argsString.includes(pattern)) {
        throw new Error(`Shell argument contains disallowed pattern: ${pattern}`);
      }
    }
  }

  return trimmed;
}

/**
 * Strip ANSI escape codes from a string.
 * This is necessary because ACP subprocess stderr outputs often contain
 * terminal color formatting, which pollutes the internal DevTools logs
 * and React UI error boundaries if not sanitized.
 * Handles color codes, cursor movements, clear lines, and other terminal sequences.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][0-9;]*[^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()[\]{}#~%@\^=\/>!]/g, '') // Single-char escape sequences
    .replace(/\x1b\x1b/g, ''); // Double escapes
}
