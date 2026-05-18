import { Notice, TFile, normalizePath } from 'obsidian';

import { generateMessageId } from './utils/uuid.ts';
import type { Plugin } from './Plugin.ts';

export interface DiffLineState {
  line: string;
  type: 'added' | 'removed' | 'unchanged';
}

function computeDiffLines(original: string, updated: string): DiffLineState[] {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');
  const result: DiffLineState[] = [];
  let oi = 0;
  let ni = 0;

  while (oi < origLines.length || ni < newLines.length) {
    if (oi >= origLines.length) {
      result.push({ line: newLines[ni]!, type: 'added' });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ line: origLines[oi]!, type: 'removed' });
      oi++;
    } else if (origLines[oi] === newLines[ni]) {
      result.push({ line: origLines[oi]!, type: 'unchanged' });
      oi++;
      ni++;
    } else {
      if (ni + 1 < newLines.length && origLines[oi] === newLines[ni + 1]) {
        result.push({ line: newLines[ni]!, type: 'added' });
        ni++;
      } else if (oi + 1 < origLines.length && origLines[oi + 1] === newLines[ni]) {
        result.push({ line: origLines[oi]!, type: 'removed' });
        oi++;
      } else {
        result.push({ line: origLines[oi]!, type: 'removed' });
        result.push({ line: newLines[ni]!, type: 'added' });
        oi++;
        ni++;
      }
    }
  }

  return result;
}

export interface PendingFileChange {
  id: string;
  newContent: string | null;
  originalContent: string;
  path: string;
  status: 'pending' | 'approved' | 'rejected' | 'partial';
  timestamp: number;
  action: 'create' | 'modify' | 'delete';
  /** Computed partial content when user selects only specific lines */
  partialContent?: string | undefined;
  /** Snapshot of diff lines at registration time to prevent race conditions */
  diffSnapshot?: DiffLineState[];
}

type ChangeCallback = (changes: PendingFileChange[]) => void;

/**
 * Manages pending file changes from the Hermes agent.
 * Instead of writing files directly, changes are held for user approval.
 */
export class FileChangeManager {
  private callbacks: ChangeCallback[] = [];
  private changes: PendingFileChange[] = [];
  private readonly MAX_HISTORY = 100;

  /**
   * Tracks paths of files currently being written to disk to prevent
   * race conditions or overlapping writes on the exact same file.
   */
  private processingPaths = new Set<string>();
  private isApprovingAll = false;
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Validate that a path is safe (within vault, no traversal).
   */
  private isPathSafe(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    return !normalized.startsWith('..') && !normalized.startsWith('/') && !normalized.includes('../');
  }

  /**
   * Register a file change from the agent.
   * Reads the current file content to compute a diff.
   */
  public async registerChange(path: string, newContent: string | null): Promise<PendingFileChange> {
    if (!this.isPathSafe(path)) {
      throw new Error(`Invalid file path: ${path}`);
    }
    let originalContent = '';
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        originalContent = await this.plugin.app.vault.read(file);
      }
    } catch {
      // File doesn't exist yet — originalContent stays empty
    }

    // Determine the user-facing action badge based on content states
    let action: 'create' | 'modify' | 'delete' = 'modify';
    if (newContent === null) {
      action = 'delete';
    } else if (!originalContent) {
      action = 'create';
    }

    const change: PendingFileChange = {
      id: generateMessageId(),
      newContent,
      originalContent,
      path,
      status: 'pending',
      timestamp: Date.now(),
      action,
      diffSnapshot: computeDiffLines(originalContent, newContent ?? '')
    };

    this.changes.push(change);
    // Enforce max history to prevent unbounded array growth over long sessions
    if (this.changes.length > this.MAX_HISTORY) {
      this.changes = this.changes.slice(-this.MAX_HISTORY);
    }
    this.notify();
    return change;
  }

  /**
   * Approve a pending change and write it to the vault.
   * If contentOverride is provided, writes that instead of change.newContent (for partial approvals).
   */
  public async approveChange(changeId: string, contentOverride?: string): Promise<void> {
    const change = this.changes.find((c) => c.id === changeId);
    if (!change || change.status !== 'pending') {
      return;
    }

    // Prevent concurrent operations on the exact same file path
    if (this.processingPaths.has(change.path)) {
      return;
    }
    this.processingPaths.add(change.path);

    try {
      const contentToWrite = contentOverride !== undefined ? contentOverride : change.newContent;
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(change.path);
      const isPartial = contentOverride !== undefined && contentOverride !== change.newContent;

      if (change.action === 'delete') {
        if (existingFile instanceof TFile) {
          await this.plugin.app.vault.trash(existingFile, true); // send to system trash
        }
      } else if (existingFile instanceof TFile && contentToWrite !== null) {
        await this.plugin.app.vault.modify(existingFile, contentToWrite);
      } else if (contentToWrite !== null) {
        const parts = change.path.split('/');
        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join('/');
          await this.plugin.vaultManager.ensureFolderExists(parentPath);
        }
        await this.plugin.app.vault.create(change.path, contentToWrite);
      }
      change.status = isPartial ? 'partial' : 'approved';
      change.partialContent = contentOverride;
      this.plugin.auditLog.recordFileChange(change.path, isPartial ? 'modify' : change.action, 'success');
      new Notice(`Applied ${isPartial ? 'partial ' : ''}changes to ${change.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to apply changes: ${message}`);
      throw error;
    } finally {
      this.processingPaths.delete(change.path);
      this.notify();
    }
  }

  /**
   * Approve all pending changes.
   */
  public async approveAll(): Promise<void> {
    if (this.isApprovingAll) return;
    this.isApprovingAll = true;

    try {
      // Snapshot pending changes atomically at the start
      const pending = this.getPendingChanges();
      if (pending.length === 0) return;

      let successCount = 0;
      for (const change of pending) {
        // Atomically check-and-set: skip if already being processed or no longer pending
        if (this.processingPaths.has(change.path)) continue;
        if (change.status !== 'pending') continue;

        this.processingPaths.add(change.path);

        try {
          const existingFile = this.plugin.app.vault.getAbstractFileByPath(change.path);
          if (change.action === 'delete') {
            if (existingFile instanceof TFile) {
              await this.plugin.app.vault.trash(existingFile, true);
            }
          } else if (existingFile instanceof TFile && change.newContent !== null) {
            await this.plugin.app.vault.modify(existingFile, change.newContent);
          } else if (change.newContent !== null) {
            const parts = change.path.split('/');
            if (parts.length > 1) {
              const parentPath = parts.slice(0, -1).join('/');
              await this.plugin.vaultManager.ensureFolderExists(parentPath);
            }
            await this.plugin.app.vault.create(change.path, change.newContent);
          }
          change.status = 'approved';
          this.plugin.auditLog.recordFileChange(change.path, change.action, 'success');
          successCount++;
        } catch (error) {
          this.plugin.debug.error(`Failed to apply changes to ${change.path}`, error);
        } finally {
          this.processingPaths.delete(change.path);
        }
      }

      if (successCount > 0) {
        new Notice(`Approved ${successCount} pending change(s)`);
        this.notify();
      }
    } finally {
      this.isApprovingAll = false;
    }
  }

  /**
   * Reject a pending change.
   */
  public rejectChange(changeId: string): void {
    const change = this.changes.find((c) => c.id === changeId);
    if (change) {
      change.status = 'rejected';
      new Notice(`Rejected changes to ${change.path}`);
    }
    this.notify();
  }

  /**
   * Reject all pending changes.
   */
  public rejectAll(): void {
    const pending = this.getPendingChanges();
    if (pending.length === 0) return;

    for (const change of pending) {
      change.status = 'rejected';
    }
    new Notice(`Rejected ${pending.length} pending change(s)`);
    this.notify();
  }

  /**
   * Get all pending changes.
   */
  public getPendingChanges(): PendingFileChange[] {
    return this.changes.filter((c) => c.status === 'pending');
  }

  /**
   * Get all changes (pending, approved, rejected).
   */
  public getAllChanges(): PendingFileChange[] {
    return [...this.changes];
  }

  /**
   * Clear approved and rejected changes.
   */
  public clearResolved(): void {
    this.changes = this.changes.filter((c) => c.status === 'pending');
    this.notify();
  }

  /**
   * Subscribe to change updates.
   */
  public onChanges(callback: ChangeCallback): () => void {
    this.callbacks.push(callback);
    // Immediately notify with current state
    callback(this.getAllChanges());
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  private notify(): void {
    const all = this.getAllChanges();
    for (const callback of this.callbacks) {
      try {
        callback(all);
      } catch {
        // Ignore callback errors
      }
    }
  }
}
