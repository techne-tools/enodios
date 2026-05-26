import { Notice, TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface AuditEntry {
  action: 'connection' | 'error' | 'file_change' | 'permission' | 'terminal' | 'tool_call';
  details: string;
  metadata?: Record<string, unknown>;
  status: 'blocked' | 'failure' | 'pending' | 'success';
  timestamp: number;
}

/**
 * Persistent audit log for all agent actions.
 *
 * DESIGN DECISIONS:
 * - Entries are queued in memory and flushed in batches (500ms delay) to avoid
 *   excessive I/O on every tool call during streaming responses.
 * - The log file is a markdown document with frontmatter for easy human reading.
 * - Entries are trimmed to max 1000 to prevent unbounded file growth.
 * - Failed flushes are logged to console but do not throw — audit logging
 *   should never break the user experience.
 *
 * SECURITY NOTE: This log contains potentially sensitive information
 * (file paths, command arguments, API errors). It is stored in the vault
 * and subject to the user's vault encryption/backup policies.
 */
export class AuditLog {
  private readonly FLUSH_DELAY_MS = 500;
  private flushTimeout: null | ReturnType<typeof setTimeout> = null;
  private readonly maxEntries = 1000;
  private readonly plugin: Plugin;
  private writeQueue: AuditEntry[] = [];

  private get logFilePath(): string {
    const folder = this.plugin.settings.chatSaveFolder || 'hermes';
    return `${folder}/audit-log.md`;
  }

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Flush queued entries to the log file.
   * Retries up to 3 times with exponential backoff. If all retries fail,
   * entries are kept in the queue and a user-visible notice is shown.
   */
  public async flush(): Promise<void> {
    if (this.writeQueue.length === 0) { return; }

    const entries = [...this.writeQueue];
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        await this.ensureLogFile();
        const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
        if (!(file instanceof TFile)) {
          throw new Error('Audit log file not found after creation');
        }

        const existing = await this.plugin.app.vault.read(file);
        const newLines = entries.map((e) => this.formatEntry(e)).join('\n');
        const updated = `${existing}\n${newLines}`;

        // Trim to max entries if needed
        const trimmed = this.trimToMaxEntries(updated);
        await this.plugin.app.vault.modify(file, trimmed);

        // Success: clear the queue and exit
        this.writeQueue = [];
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.plugin.debug.error(`AuditLog flush failed (attempt ${attempts}/${maxAttempts})`, error);

        if (attempts >= maxAttempts) {
          // All retries exhausted: keep entries in queue for next flush
          // and alert the user that audit logging is broken
          new Notice(`Hermes audit log failed after ${maxAttempts} attempts. ${entries.length} entries queued for retry.`);
          console.error('[Hermes] AuditLog flush failed permanently:', message);
        } else {
          // Exponential backoff: 500ms, 1000ms, 2000ms
          const delay = 500 * (2 ** (attempts - 1));
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
      const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
      if (!(file instanceof TFile)) { return []; }

      const content = await this.plugin.app.vault.read(file);
      return this.parseEntries(content).slice(-count);
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
  }

  /**
   * Convenience method for connection events.
   */
  public recordConnection(event: 'connect' | 'disconnect' | 'mcp_servers' | 'reconnect', mode: string, status: AuditEntry['status'], error?: string): void {
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
  public recordFileChange(path: string, action: 'create' | 'delete' | 'modify', status: AuditEntry['status']): void {
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
  public recordPermission(permissionType: string, outcome: string, status: AuditEntry['status']): void {
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
  public recordTerminal(command: string, status: AuditEntry['status'], exitCode?: null | number): void {
    this.record({
      action: 'terminal',
      details: `\`${command}\`${exitCode !== null && exitCode !== undefined ? ` (exit: ${exitCode})` : ''}`,
      metadata: { command, exitCode },
      status
    });
  }

  /**
   * Convenience method for tool calls.
   */
  public recordToolCall(toolName: string, params: Record<string, unknown>, status: AuditEntry['status'], error?: string): void {
    this.record({
      action: 'tool_call',
      details: `${toolName}: ${JSON.stringify(params)}`,
      metadata: { error, params, toolName },
      status
    });
  }

  private async ensureLogFile(): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
    if (file instanceof TFile) { return; }

    // Ensure parent folder exists
    const parts = this.logFilePath.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      await this.plugin.vaultManager.ensureFolderExists(parentPath);
    }

    const header = '---\ntype: hermes-audit-log\ngeneratedBy: obsidian-hermes\n---\n\n# Hermes Action Audit Log\n\n> This file records all tool invocations, file changes, permission grants, and terminal commands for transparency and debugging.\n\n';
    await this.plugin.app.vault.create(this.logFilePath, header);
  }

  private formatEntry(entry: AuditEntry): string {
    const time = new Date(entry.timestamp).toISOString();
    const icon = {
      blocked: '🚫',
      failure: '❌',
      pending: '⏳',
      success: '✅'
    }[entry.status];

    const actionLabel = {
      connection: '🔌',
      error: '💥',
      file_change: '📝',
      permission: '🔐',
      terminal: '💻',
      tool_call: '🔧'
    }[entry.action];

    return `- ${icon} ${actionLabel} **${entry.action}** — ${time}\n  - ${entry.details}`;
  }

  private parseEntries(content: string): AuditEntry[] {
    const entries: AuditEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = /^- [🚫❌⏳✅] [🔌💥📝🔐💻🔧] \*\*(\w+)\*\* — (.+)$/.exec(line);
      if (match?.[2]) {
        const action = match[1] as AuditEntry['action'];
        const timestamp = new Date(match[2]).getTime();
        if (!Number.isNaN(timestamp)) {
          entries.push({
            action,
            details: '',
            status: 'success',
            timestamp
          });
        }
      }
    }

    return entries;
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

  private trimToMaxEntries(content: string): string {
    const lines = content.split('\n');
    const entryLines = lines.filter((l) => l.startsWith('- '));
    if (entryLines.length <= this.maxEntries) { return content; }

    const excess = entryLines.length - this.maxEntries;
    let skipped = 0;
    const trimmed = lines.filter((l) => {
      if (l.startsWith('- ') && skipped < excess) {
        skipped++;
        return false;
      }
      return true;
    });

    return trimmed.join('\n');
  }
}
