import { TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface AuditEntry {
  timestamp: number;
  action: 'tool_call' | 'file_change' | 'permission' | 'terminal' | 'connection' | 'error';
  status: 'success' | 'failure' | 'pending' | 'blocked';
  details: string;
  metadata?: Record<string, unknown>;
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
  private readonly plugin: Plugin;
  private readonly maxEntries = 1000;
  private writeQueue: AuditEntry[] = [];
  private flushTimeout: number | null = null;
  private readonly FLUSH_DELAY_MS = 500;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get logFilePath(): string {
    const folder = this.plugin.settings.chatSaveFolder || 'hermes';
    return `${folder}/audit-log.md`;
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

  /**
   * Convenience method for file changes.
   */
  public recordFileChange(path: string, action: 'create' | 'modify' | 'delete', status: AuditEntry['status']): void {
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
  public recordTerminal(command: string, status: AuditEntry['status'], exitCode?: number | null): void {
    this.record({
      action: 'terminal',
      details: `\`${command}\`${exitCode !== null && exitCode !== undefined ? ` (exit: ${exitCode})` : ''}`,
      metadata: { command, exitCode },
      status
    });
  }

  /**
   * Convenience method for connection events.
   */
  public recordConnection(event: 'connect' | 'disconnect' | 'reconnect', mode: string, status: AuditEntry['status'], error?: string): void {
    this.record({
      action: 'connection',
      details: `${event.toUpperCase()} (${mode})${error ? `: ${error}` : ''}`,
      metadata: { error, event, mode },
      status
    });
  }

  /**
   * Get recent audit entries from the log file.
   */
  public async getRecentEntries(count = 50): Promise<AuditEntry[]> {
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
      if (!(file instanceof TFile)) return [];

      const content = await this.plugin.app.vault.read(file);
      return this.parseEntries(content).slice(-count);
    } catch {
      return [];
    }
  }

  /**
   * Flush queued entries to the log file.
   */
  public async flush(): Promise<void> {
    if (this.writeQueue.length === 0) return;

    const entries = [...this.writeQueue];
    this.writeQueue = [];

    try {
      await this.ensureLogFile();
      const file = this.plugin.app.vault.getAbstractFileByPath(this.logFilePath);
      if (!(file instanceof TFile)) return;

      const existing = await this.plugin.app.vault.read(file);
      const newLines = entries.map((e) => this.formatEntry(e)).join('\n');
      const updated = existing + '\n' + newLines;

      // Trim to max entries if needed
      const trimmed = this.trimToMaxEntries(updated);
      await this.plugin.app.vault.modify(file, trimmed);
    } catch (error) {
      this.plugin.debug.error('AuditLog flush failed', error);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout !== null) {
      window.clearTimeout(this.flushTimeout);
    }
    this.flushTimeout = window.setTimeout(() => {
      this.flushTimeout = null;
      void this.flush();
    }, this.FLUSH_DELAY_MS);
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

    const header = `---\ntype: hermes-audit-log\ngeneratedBy: obsidian-hermes\n---\n\n# Hermes Action Audit Log\n\n> This file records all tool invocations, file changes, permission grants, and terminal commands for transparency and debugging.\n\n`;
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
      const match = line.match(/^- [🚫❌⏳✅] [🔌💥📝🔐💻🔧] \*\*(\w+)\*\* — (.+)$/);
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

  private trimToMaxEntries(content: string): string {
    const lines = content.split('\n');
    const entryLines = lines.filter((l) => l.startsWith('- '));
    if (entryLines.length <= this.maxEntries) return content;

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
