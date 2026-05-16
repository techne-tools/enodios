import { Notice, TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface PendingFileChange {
  id: string;
  newContent: string;
  originalContent: string;
  path: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
}

type ChangeCallback = (changes: PendingFileChange[]) => void;

/**
 * Manages pending file changes from the Hermes agent.
 * Instead of writing files directly, changes are held for user approval.
 */
export class FileChangeManager {
  private callbacks: ChangeCallback[] = [];
  private changes: PendingFileChange[] = [];
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Register a file change from the agent.
   * Reads the current file content to compute a diff.
   */
  public async registerChange(path: string, newContent: string): Promise<PendingFileChange> {
    let originalContent = '';
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        originalContent = await this.plugin.app.vault.read(file);
      }
    } catch {
      // File doesn't exist yet — originalContent stays empty
    }

    const change: PendingFileChange = {
      id: `change-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      newContent,
      originalContent,
      path,
      status: 'pending',
      timestamp: Date.now()
    };

    this.changes.push(change);
    this.notify();
    return change;
  }

  /**
   * Approve a pending change and write it to the vault.
   */
  public async approveChange(changeId: string): Promise<void> {
    const change = this.changes.find((c) => c.id === changeId);
    if (!change || change.status !== 'pending') {
      return;
    }

    try {
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(change.path);
      if (existingFile instanceof TFile) {
        await this.plugin.app.vault.modify(existingFile, change.newContent);
      } else {
        await this.plugin.app.vault.create(change.path, change.newContent);
      }
      change.status = 'approved';
      new Notice(`Applied changes to ${change.path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to apply changes: ${message}`);
      throw error;
    } finally {
      this.notify();
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
