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
import { existsSync, statSync } from 'fs';
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
  args?: string | undefined;
  callId: string;
  name: string;
  result?: string | undefined;
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
 *
 * ARCHITECTURAL ROLE:
 * This is the "local" backend for chat. It spawns the Hermes CLI as a child
 * process and speaks the Agent Client Protocol (ACP) over stdin/stdout.
 * The ACP protocol is a JSON-RPC-like bidirectional stream that supports:
 *   - Prompt/response messaging
 *   - Tool calls (file read/write, terminal, permissions)
 *   - Streaming updates (message chunks, reasoning, tool progress)
 *   - Session management (create, close, reconnect)
 *
 * COMPARISON TO HermesApiClient:
 * | Feature          | AcpClient (local)          | HermesApiClient (remote)   |
 * |------------------|----------------------------|----------------------------|
 * | Connection       | Persistent subprocess      | Stateless HTTP + SSE       |
 * | Terminal         | Full PTY emulation         | Not available              |
 * | File approval    | Inline diff via FileChange | Direct write (no approval) |
 * | Reconnection     | Auto-reconnect with backoff| Auto-reconnect with backoff|
 * | Permissions      | ACP permission flow        | N/A                        |
 *
 * SECURITY HIGHLIGHTS:
 * - Shell commands are sanitized via `sanitizeShellCommand()` — only a
 *   whitelist of safe utilities is permitted, and dangerous argument patterns
 *   (pipes, redirects, command substitution) are rejected.
 * - Path traversal is blocked by `isPathSafe()` — absolute paths, parent
 *   directory references (`../`), and null bytes are all rejected.
 * - Terminal access is gated by the `allowTerminal` setting (off by default).
 * - MCP servers are explicitly opt-in and logged as a security event.
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
  // Rate limiting: prevent accidental or malicious prompt flooding
  private lastPromptTime = 0;
  private readonly PROMPT_RATE_LIMIT_MS = 1000;
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
      p.resolve({ outcome: { outcome: 'cancelled' } } as RequestPermissionResponse);
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
        outcome: { outcome: 'cancelled' }
      } as RequestPermissionResponse);
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

    // SECURITY: Auto-approval is gated by user setting (default: disabled).
    // Even when enabled, only single-option allow permissions are auto-approved.
    // This prevents malicious agents from crafting single-option permissions
    // to bypass user review.
    const autoApproveEnabled = this.plugin.settings.autoApproveSingleOptionPermissions;

    const pending = [...this.pendingPermissions];
    this.pendingPermissions = [];
    for (const p of pending) {
      const options = p.params.options ?? [];
      const allowOptions = options.filter((o: Record<string, unknown>) => String(o['kind']).startsWith('allow_'));
      const permType = String((p.params as unknown as Record<string, unknown>)['permissionType'] || 'permission');

      // SECURITY: Only auto-approve permissions that have exactly one option
      // and that option is an allow, AND only when the user has explicitly
      // enabled auto-approval in settings. Permissions with multiple options
      // (or a mix of allow/deny) always require explicit per-permission review.
      if (autoApproveEnabled && allowOptions.length === 1 && options.length === 1) {
        const outcome = String(allowOptions[0]!.kind || allowOptions[0]!.optionId);
        this.plugin.auditLog.recordPermission(permType, outcome, 'success');
        p.resolve({
          outcome: {
            optionId: String(allowOptions[0]!.optionId),
            outcome: 'selected'
          }
        } as RequestPermissionResponse);
      } else {
        this.plugin.auditLog.recordPermission(permType, 'cancelled', 'failure');
        p.resolve({ outcome: { outcome: 'cancelled' } } as RequestPermissionResponse);
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
        outcome: {
          optionId,
          outcome: 'selected'
        }
      } as RequestPermissionResponse);
      this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== permissionId);
      this.notifyPermissions();
    }
  }

  /**
   * Send a prompt to the ACP session.
   */
  public async sendPrompt(text: string, contextItems: PromptContextItem[] = [], options?: { allowedTools?: null | string[] }): Promise<void> {
    // Normalize empty array to null: [] means "no restrictions" (same as null),
    // not "no tools allowed". An empty array causes checkToolAllowed to reject
    // everything while the system prompt tells the agent nothing useful.
    this.currentAllowedTools = options?.allowedTools?.length ? options.allowedTools : null;

    // Rate limiting: prevent accidental or malicious prompt flooding
    const now = Date.now();
    if (now - this.lastPromptTime < this.PROMPT_RATE_LIMIT_MS) {
      throw new Error('Please wait a moment before sending another prompt.');
    }
    this.lastPromptTime = now;

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

    // Inject system override instructions for tool behavior
    promptBlocks.push({
      text: "CRITICAL INSTRUCTION: If a tool call (especially file edits like patch or write_file) fails with a 'Permission Denied' or 'cancelled' error, this means the user explicitly reviewed your proposed change and REJECTED it. You MUST NOT retry the tool call. Acknowledge the rejection and ask the user how they would like to proceed instead.",
      type: 'text'
    });

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

    // ACP workspace integration note.
    // The Hermes ACP toolset uses native tools (write_file, patch, read_file,
    // search_files) which run on the agent's machine with CWD set to the vault.
    // The agent also may use fs/write_text_file / fs/read_text_file client
    // methods, which go through Obsidian's file approval flow with inline diffs.
    //
    // We DON'T block either path — both are valid. We just explain the trade-off:
    // native tools: faster, no inline diff
    // client methods: shows inline diff, user approves via FileChangeManager
    const toolNote: string[] = [
      '## Workspace & Tool Note',
      '',
      'Your working directory (CWD) is set to the Obsidian vault root.',
      'All file operations via write_file, patch, read_file, and search_files run here.',
      '',
      '### Client methods (optional, for inline diffs)',
      '- fs/write_text_file — writes through Obsidian file approval with inline diff',
      '- fs/read_text_file — reads through the Obsidian vault API'
    ];

    // Add terminal condition
    if (!this.plugin.settings.allowTerminal) {
      toolNote.push('', '### Terminal restriction',
        'Terminal access is DISABLED in settings. Do not use terminal, bash, or process tools.');
    }

    // Add session-level tool restrictions on top, if any
    if (this.currentAllowedTools) {
      toolNote.push(
        '',
        '### Session Tool Restrictions',
        `For this session you are RESTRICTED to ONLY: ${this.currentAllowedTools.join(', ')}.`,
        'Do not attempt to use any other tools or client methods.'
      );
    }

    promptBlocks.push({
      text: toolNote.join('\n'),
      type: 'text'
    });

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
        this.checkToolAllowed('terminal');
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

        // SECURITY: Validate all arguments for dangerous patterns before spawning.
        // Some "safe" commands have configuration options that enable arbitrary
        // code execution (e.g., git --config core.sshCommand=...).
        sanitizeShellArguments(args);

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
        this.checkToolAllowed('read_file');

        if (!isPathSafe(params.path)) {
          this.plugin.auditLog.recordToolCall('read_file', { path: params.path }, 'blocked', 'Path traversal denied');
          throw new Error(`Path traversal denied: ${params.path}`);
        }
        const normalized = normalizePath(params.path);

        try {
          const file = this.plugin.app.vault.getAbstractFileByPath(normalized);
          if (!(file instanceof TFile)) {
            this.plugin.auditLog.recordToolCall('read_file', { path: params.path }, 'failure', 'File not found');
            throw new Error(`File not found: ${params.path}`);
          }
          const content = await this.plugin.app.vault.read(file);
          this.plugin.auditLog.recordToolCall('read_file', { path: params.path }, 'success');
          return { content };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.auditLog.recordToolCall('read_file', { path: params.path }, 'failure', message);
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
        // Pass all permission requests through to the UI for user approval.
        // The agent's native tools (write_file, patch, read_file, search_files)
        // run on the agent's machine with CWD set to the vault root, so
        // approved writes go directly to the vault filesystem.
        // For diff-based file approval, the agent should use fs/write_text_file.
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
        this.checkToolAllowed('write_file');
        try {
          // Queue the change for user approval instead of writing immediately
          await this.plugin.fileChangeManager.registerChange(params.path, params.content);
          this.plugin.auditLog.recordFileChange(params.path, params.content === null ? 'delete' : 'modify', 'pending');
          return {};
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.auditLog.recordToolCall('write_file', { path: params.path }, 'failure', message);
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

      // SECURITY: Validate MCP server paths before passing to the agent.
      // Reject world-writable files, temporary directories, and non-absolute paths.
      const validatedMcpServers: string[] = [];
      for (const serverPath of mcpServers) {
        try {
          validateMcpServerPath(serverPath);
          validatedMcpServers.push(serverPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.plugin.auditLog.recordConnection('mcp_servers', 'acp', 'blocked', `rejected ${serverPath}: ${message}`);
          this.plugin.debug.warn(`MCP server rejected: ${message}`);
        }
      }
      mcpServers = validatedMcpServers;

      // Security Note: MCP servers are external executables spawned by the Hermes agent.
      // Configuring untrusted MCP servers poses a significant security risk, as they can
      // execute arbitrary code on the user's system with the privileges of the Obsidian process.
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
        // The ACP protocol uses `title` (not `name`) for the human-readable tool name,
        // and `toolCallId` (not `callId`) for the unique identifier.
        const toolUpdate = update as {
          kind?: string;
          locations?: Array<{ path: string }>;
          rawInput?: unknown;
          rawOutput?: unknown;
          status?: string;
          title?: string;
          toolCallId?: string;
        };
        const statusMap: Record<string, 'complete' | 'error' | 'running'> = {
          completed: 'complete',
          failed: 'error',
          in_progress: 'running',
          pending: 'running'
        };

        const status = statusMap[toolUpdate.status ?? ''] ?? 'running';
        const resultStr = toolUpdate.rawOutput !== undefined
          ? (typeof toolUpdate.rawOutput === 'string' ? toolUpdate.rawOutput : JSON.stringify(toolUpdate.rawOutput, null, 2))
          : undefined;

        // The tool name is in `title` per the ACP spec. `kind` gives the category.
        const toolName = toolUpdate.title
          ?? toolUpdate.kind
          ?? 'unknown-tool';

        const toolCallId = toolUpdate.toolCallId ?? '';

        const toolCall: AcpToolCall = {
          args: toolUpdate.rawInput !== undefined
            ? (typeof toolUpdate.rawInput === 'string' ? toolUpdate.rawInput : JSON.stringify(toolUpdate.rawInput))
            : undefined,
          callId: toolCallId,
          name: toolName,
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
        // NOTE: The ACP protocol's usage_update only provides `size` (total)
        // and `used` (input/consumed). There is no separate output token count
        // in this message type, so we report outputTokens as 0. The UI's
        // TokenUsageFooter will show total = input + 0, which is slightly
        // misleading but the best we can do with the current protocol version.
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
  // Reject UNC paths (Windows network shares)
  if (normalized.startsWith('\\\\')) {
    return false;
  }
  // SECURITY NOTE: Symlink traversal is NOT checked here. If the vault
  // contains a symlink to a sensitive directory, the agent can traverse it.
  // This is a known limitation; future versions should resolve symlinks
  // via fs.realpath() and verify the resolved path is within the vault.
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
 * Validate an MCP server executable path for security concerns.
 * Rejects temporary directories, world-writable files, and relative paths.
 *
 * SECURITY NOTE: This is a best-effort check. A determined attacker with
 * control of the filesystem can bypass these checks (e.g., by changing
 * permissions after validation). The primary defense is user vigilance
 * when configuring MCP servers.
 */
function validateMcpServerPath(serverPath: string): void {
  if (!serverPath.startsWith('/')) {
    throw new Error('MCP server path must be absolute');
  }
  const tmpDirs = ['/tmp', '/var/tmp', '/dev/shm', '/run'];
  for (const tmp of tmpDirs) {
    if (serverPath.startsWith(tmp)) {
      throw new Error(`MCP server cannot be in a temporary directory: ${tmp}`);
    }
  }
  try {
    const stats = statSync(serverPath);
    // Check if world-writable (last octal digit includes 2)
    if ((stats.mode & 0o002) !== 0) {
      throw new Error('MCP server file is world-writable');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('world-writable')) {
      throw error;
    }
    throw new Error(`Cannot stat MCP server file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate shell arguments for dangerous patterns.
 * Each argument is checked individually against DANGEROUS_ARG_PATTERNS.
 * This prevents option injection attacks where a "safe" command like `git`
 * is passed a dangerous argument like `--config core.sshCommand=rm -rf /`.
 *
 * SECURITY NOTE: This is a defense-in-depth measure. With `shell: false`,
 * arguments are passed directly to the executable, but some commands have
 * configuration options that enable arbitrary code execution.
 */
function sanitizeShellArguments(args: string[]): void {
  for (const arg of args) {
    for (const pattern of DANGEROUS_ARG_PATTERNS) {
      if (arg.includes(pattern)) {
        throw new Error(`Shell argument contains disallowed pattern: ${pattern}`);
      }
    }
  }
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
