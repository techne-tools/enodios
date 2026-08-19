import {
  Notice,
  TFile
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface AuditEntry {
  action:
    | 'connection'
    | 'error'
    | 'file_change'
    | 'permission'
    | 'terminal'
    | 'tool_call';
  details: string;
  metadata?: Record<string, unknown>;
  status: 'blocked' | 'failure' | 'pending' | 'success';
  timestamp: number;
}

/**
 * Persistent audit log for all agent actions.
 *
 * ARCHITECTURAL ROLE:
 * Every significant agent action (file writes, terminal commands, permission
 * requests, connection events) is recorded here. This provides:
 *   1. Accountability — users can review what the agent did
 *   2. Debugging — developers can trace the sequence of events leading to errors
 *   3. Security forensics — if something goes wrong, the audit trail shows exactly
 *      which commands were run and which files were touched
 *
 * DESIGN DECISIONS:
 * - Entries are queued in memory and flushed in batches (500ms delay) to avoid
 *   excessive I/O on every tool call during streaming responses.
 * - The log file stores a **structured JSON array** of entries. This preserves
 *   all metadata, status, and error details on read (unlike the previous
 *   Markdown round-trip, which discarded most fields).
 * - A serialization lock (`flushPromise`) prevents concurrent flushes from
 *   racing on the read-modify-write cycle, which could drop or corrupt entries.
 * - Entries are trimmed to max 1000 to prevent unbounded file growth.
 * - Failed flushes are logged to console but do not throw — audit logging
 *   should never break the user experience.
 * - Retries use exponential backoff (500ms, 1000ms, 2000ms) to handle transient
 *   vault locks or disk pressure.
 *
 * SECURITY WARNING: This log contains potentially SENSITIVE INFORMATION
 * (file paths, command arguments, API errors, permission types). It is
 * stored as PLAINTEXT in the vault. Users should:
 *   1. Not share the audit log file publicly
 *   2. Be cautious when syncing the vault to cloud services or public repos
 *   3. Consider disabling audit logging in highly sensitive environments
 *      (future versions may add a setting for this)
 *
 * The log is subject to the user's vault encryption/backup policies.
 */
export class AuditLog {
  private readonly FLUSH_DELAY_MS = 500;
  private flushTimeout: null | ReturnType<typeof setTimeout> = null;
  private readonly maxEntries = 1000;
  private readonly plugin: Plugin;
  private writeQueue: AuditEntry[] = [];
  private callbacks: (() => void)[] = [];
  /** Serialization lock: prevents concurrent flushes from racing. */
  private flushPromise: null | Promise<void> = null;

  private get logFilePath(): string {
    const folder = this.plugin.settings.chatSaveFolder || 'enodios';
    return `${folder}/audit-log.md`;
  }

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Flush queued entries to the log file.
   * Retries up to 3 times with exponential backoff. If all retries fail,
   * entries are kept in the queue and a user-visible notice is shown.
   * Concurrent calls are serialized via `flushPromise`.
   */
  public async flush(): Promise<void> {
    if (this.writeQueue.length === 0) return;

    // Serialize concurrent flushes.
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.doFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async doFlush(): Promise<void> {
    const entries = [...this.writeQueue];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        await this.ensureLogFile();
        const file = this.plugin.app.vault.getAbstractFileByPath(
          this.logFilePath
        );
        if (!(file instanceof TFile)) {
          throw new Error('Audit log file not found after creation');
        }

        const existing = await this.readEntries(file);
        const merged = [...existing, ...entries];
        const trimmed = merged.slice(-this.maxEntries);
        await this.plugin.app.vault.modify(
          file,
          JSON.stringify(trimmed, null, 2)
        );

        // Success: clear the queue and exit
        this.writeQueue = [];
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.debug.error(
          `AuditLog flush failed (attempt ${String(attempts)}/${String(maxAttempts)})`,
          error
        );

        if (attempts >= maxAttempts) {
          // All retries exhausted: keep entries in queue for next flush
          // and alert the user that audit logging is broken
          new Notice(
            `Hermes audit log failed after ${String(maxAttempts)} attempts. ${String(entries.length)} entries queued for retry.`
          );
          console.error('[Hermes] AuditLog flush failed permanently:', message);
        } else {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = 500 * 2 ** (attempts - 1);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delay);
          });
        }
      }
    }
  }

  /**
   * Get recent audit entries from the log file.
   */
  public async getRecentEntries(count = 50): Promise<AuditEntry[]> {
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(
        this.logFilePath
      );
      if (!(file instanceof TFile)) return [];

      return (await this.readEntries(file)).slice(-count);
    } catch {
      return [];
    }
  }

  /**
   * Record a single audit entry. Queued for batch writing.
   */
  public record(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.writeQueue.push({
      ...entry,
      timestamp: Date.now()
    });
    this.scheduleFlush();
    this.notify();
  }

  /**
   * Subscribe to changes in the audit log.
   */
  public onChange(callback: () => void): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Clear the audit log (both in memory and file).
   */
  public async clear(): Promise<void> {
    this.writeQueue = [];
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(
        this.logFilePath
      );
      if (file instanceof TFile) {
        await this.plugin.app.vault.modify(file, '[]');
      }
    } catch (error) {
      this.plugin.debug.error('Failed to clear audit log file', error);
    }
    this.notify();
  }

  private notify(): void {
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Convenience method for connection events.
   */
  public recordConnection(
    event: 'connect' | 'disconnect' | 'mcp_servers' | 'reconnect',
    mode: string,
    status: AuditEntry['status'],
    error?: string
  ): void {
    this.record({
      action: 'connection',
      details: `${event.toUpperCase()} (${mode})${error ? `: ${error}` : ''}`,
      metadata: { error, event, mode },
      status
    });
  }

  /**
   * Convenience method for file changes.
   */
  public recordFileChange(
    path: string,
    action: 'create' | 'delete' | 'modify',
    status: AuditEntry['status']
  ): void {
    this.record({
      action: 'file_change',
      details: `${action.toUpperCase()} ${path}`,
      metadata: { action, path },
      status
    });
  }

  /**
   * Convenience method for permission grants.
   */
  public recordPermission(
    permissionType: string,
    outcome: string,
    status: AuditEntry['status']
  ): void {
    this.record({
      action: 'permission',
      details: `${permissionType} → ${outcome}`,
      metadata: { outcome, permissionType },
      status
    });
  }

  /**
   * Convenience method for terminal commands.
   */
  public recordTerminal(
    command: string,
    status: AuditEntry['status'],
    exitCode?: null | number
  ): void {
    this.record({
      action: 'terminal',
      details: `\`${command}\`${exitCode !== null && exitCode !== undefined ? ` (exit: ${String(exitCode)})` : ''}`,
      metadata: { command, exitCode },
      status
    });
  }

  /**
   * Convenience method for tool calls.
   */
  public recordToolCall(
    toolName: string,
    params: Record<string, unknown>,
    status: AuditEntry['status'],
    error?: string
  ): void {
    this.record({
      action: 'tool_call',
      details: `${toolName}: ${JSON.stringify(params)}`,
      metadata: { error, params, toolName },
      status
    });
  }

  private async ensureLogFile(): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
    if (file instanceof TFile) return;

    // Ensure parent folder exists
    const parts = this.logFilePath.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      await this.plugin.vaultManager.ensureFolderExists(parentPath);
    }

    await this.plugin.app.vault.create(this.logFilePath, '[]');
  }

  /**
   * Read and parse the structured JSON array of entries from the log file.
   * Tolerates legacy Markdown-format files by returning an empty array.
   */
  private async readEntries(file: TFile): Promise<AuditEntry[]> {
    const content = await this.plugin.app.vault.read(file);
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isAuditEntry);
      }
    } catch {
      // Legacy Markdown format or malformed content — treat as empty.
    }
    return [];
  }

  private scheduleFlush(): void {
    if (this.flushTimeout !== null) {
      clearTimeout(this.flushTimeout);
    }
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;

      void this.flush();
    }, this.FLUSH_DELAY_MS);
  }
}

/**
 * Type guard for audit entries parsed from the JSON log file.
 */
function isAuditEntry(value: unknown): value is AuditEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['action'] === 'string'
    && typeof entry['details'] === 'string'
    && typeof entry['status'] === 'string'
    && typeof entry['timestamp'] === 'number'
  );
}
