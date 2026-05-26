import {
  MarkdownView,
  normalizePath,
  Notice,
  TFile
} from 'obsidian';

import { EditorView } from '@codemirror/view';

import type { Plugin } from './Plugin.ts';

import { setInlineDiffEffect } from './styles/InlineDiffExtension.ts';
import { generateMessageId } from './utils/uuid.ts';

export interface DiffLineState {
  line: string;
  type: 'added' | 'removed' | 'unchanged';
}

export interface PendingFileChange {
  action: 'create' | 'delete' | 'modify';
  /** Snapshot of diff lines at registration time to prevent race conditions */
  diffSnapshot?: DiffLineState[];
  id: string;
  newContent: null | string;
  originalContent: string;
  /** Computed partial content when user selects only specific lines */
  partialContent?: string | undefined;
  path: string;
  status: 'approved' | 'partial' | 'pending' | 'rejected';
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
  private isApprovingAll = false;

  private readonly MAX_HISTORY = 100;
  private readonly plugin: Plugin;
  /**
   * Tracks paths of files currently being written to disk to prevent
   * race conditions or overlapping writes on the exact same file.
   */
  private processingPaths = new Set<string>();
  private notifyTimeout: null | ReturnType<typeof setTimeout> = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Cleanup timeouts and callbacks on plugin unload.
   */
  public destroy(): void {
    if (this.notifyTimeout !== null) {
      clearTimeout(this.notifyTimeout);
      this.notifyTimeout = null;
    }
    this.callbacks = [];
  }

  /**
   * Approve all pending changes.
   */
  public async approveAll(): Promise<void> {
    if (this.isApprovingAll) { return; }
    this.isApprovingAll = true;

    try {
      // Snapshot pending changes atomically at the start
      const pending = this.getPendingChanges();
      if (pending.length === 0) { return; }

      let successCount = 0;
      for (const change of pending) {
        // Atomically check-and-set: skip if already being processed or no longer pending
        if (this.processingPaths.has(change.path)) { continue; }
        if (change.status !== 'pending') { continue; }

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
          this.clearInlineDiffForPath(change.path);
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
   * Approve a pending change and write it to the vault.
   * If contentOverride is provided, writes that instead of change.newContent (for partial approvals).
   */
  public async approveChange(changeId: string, contentOverride?: string): Promise<void> {
    const change = this.changes.find((c) => c.id === changeId);
    if (change?.status !== 'pending') {
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
          await this.plugin.app.vault.trash(existingFile, true); // Send to system trash
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

      // Refresh diff snapshots for any remaining pending changes on the same file
      // so the UI shows diffs against the newly-written content.
      await this.refreshPendingDiffsForPath(change.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to apply changes: ${message}`);
      throw error;
    } finally {
      this.processingPaths.delete(change.path);
      this.clearInlineDiffForPath(change.path);
      this.notify();
    }
  }

  /**
   * Clear approved and rejected changes.
   */
  public clearResolved(): void {
    this.changes = this.changes.filter((c) => c.status === 'pending');
    this.notify();
  }

  /**
   * Get all changes (pending, approved, rejected).
   */
  public getAllChanges(): PendingFileChange[] {
    return [...this.changes];
  }

  /**
   * Get all pending changes.
   */
  public getPendingChanges(): PendingFileChange[] {
    return this.changes.filter((c) => c.status === 'pending');
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

  /**
   * Register a file change from the agent.
   * Reads the current file content to compute a diff.
   */
  public async registerChange(path: string, newContent: null | string): Promise<PendingFileChange> {
    if (!this.isPathSafe(path)) {
      throw new Error(`Invalid file path: ${path}`);
    }

    // Check if there is already a pending change for this path to coalesce rapid updates
    let existingPendingIndex = this.changes.findIndex((c) => c.path === path && c.status === 'pending');

    let originalContent = '';
    if (existingPendingIndex !== -1) {
      // Keep the original content from when the first change was proposed (already normalized)
      originalContent = this.changes[existingPendingIndex]!.originalContent;
    } else {
      try {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          originalContent = await this.plugin.app.vault.read(file);
        }
      } catch {
        // File doesn't exist yet — originalContent stays empty
      }
      // Normalize line endings to \n to prevent diff mismatches on Windows
      originalContent = originalContent.replace(/\r\n/g, '\n');

      // Re-evaluate pending index because `await` yielded the event loop
      // Another rapid call could have pushed a pending change while we were reading disk
      existingPendingIndex = this.changes.findIndex((c) => c.path === path && c.status === 'pending');
      if (existingPendingIndex !== -1) {
        // Fall back to the original content from the first registered change
        originalContent = this.changes[existingPendingIndex]!.originalContent;
      }
    }

    if (newContent !== null) {
      newContent = newContent.replace(/\r\n/g, '\n');
    }

    // Determine the user-facing action badge based on content states
    let action: 'create' | 'delete' | 'modify' = 'modify';
    if (newContent === null) {
      action = 'delete';
    } else if (!originalContent) {
      action = 'create';
    }

    const change: PendingFileChange = {
      action,
      diffSnapshot: computeDiffLines(originalContent, newContent ?? ''),
      id: generateMessageId(),
      newContent,
      originalContent,
      path,
      status: 'pending',
      timestamp: Date.now()
    };

    if (existingPendingIndex !== -1) {
      // Coalesce / overwrite the existing pending change to prevent rapid duplicates
      // Preserve the original ID so the React UI doesn't forcibly unmount if expanded
      change.id = this.changes[existingPendingIndex]!.id;
      this.changes[existingPendingIndex] = change;
    } else {
      this.changes.push(change);
      // Enforce max history to prevent unbounded array growth over long sessions
      if (this.changes.length > this.MAX_HISTORY) {
        this.changes = this.changes.slice(-this.MAX_HISTORY);
      }
    }
    this.notify();

    // Trigger inline diff in the active editor if the file is currently open
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file?.path === path) {
      // @ts-expect-error - Accessing internal CodeMirror 6 view from Obsidian's Editor wrapper
      const cmView = activeView.editor.cm;
      if (cmView) {
        this.triggerInlineDiff(change, cmView);
      }
    }

    return change;
  }

  /**
   * Trigger inline diff rendering in the provided editor view.
   */
  private triggerInlineDiff(change: PendingFileChange, view: EditorView): void {
    // Find the position to insert the diff (at the start of the file content)
    const startPos = 0;

    view.dispatch({
      effects: setInlineDiffEffect.of({
        lines: change.diffSnapshot ?? [],
        startPos
      })
    });
  }

  /**
   * Clear inline diff rendering in the provided editor view if it matches the path.
   */
  private clearInlineDiffForPath(path: string): void {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.file?.path === path) {
      // @ts-expect-error - Accessing internal CodeMirror 6 view from Obsidian's Editor wrapper
      const cmView = activeView.editor.cm as EditorView;
      if (cmView) {
        cmView.dispatch({ effects: setInlineDiffEffect.of(null) });
      }
    }
  }

  /**   * Re-compute diff snapshots for all remaining pending changes on a given path.
   * Call this after a change to that path has been approved so the UI shows
   * diffs against the newly-written content rather than stale originalContent.
   */
  private async refreshPendingDiffsForPath(path: string): Promise<void> {
    const pendingOnPath = this.changes.filter((c) => c.path === path && c.status === 'pending');
    if (pendingOnPath.length === 0) { return; }

    // Read the current file content from disk (or empty if deleted)
    let currentContent = '';
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        currentContent = await this.plugin.app.vault.read(file);
      }
    } catch {
      // File may not exist — keep empty
    }
    currentContent = currentContent.replace(/\r\n/g, '\n');

    for (const change of pendingOnPath) {
      change.originalContent = currentContent;
      change.diffSnapshot = computeDiffLines(currentContent, change.newContent ?? '');
    }
  }

  /**   * Reject all pending changes.
   */
  public rejectAll(): void {
    const pending = this.getPendingChanges();
    if (pending.length === 0) { return; }

    for (const change of pending) {
      change.status = 'rejected';
      this.clearInlineDiffForPath(change.path);
    }
    new Notice(`Rejected ${pending.length} pending change(s)`);
    this.notify();
  }

  /**
   * Reject a pending change.
   */
  public rejectChange(changeId: string): void {
    const change = this.changes.find((c) => c.id === changeId);
    if (change) {
      change.status = 'rejected';
      new Notice(`Rejected changes to ${change.path}`);
      this.clearInlineDiffForPath(change.path);
    }
    this.notify();
  }

  /**
   * Validate that a path is safe (within vault, no traversal).
   * Rejects absolute paths, parent-directory traversal, null bytes, control
   * characters, and Windows drive-letter paths.
   */
  private isPathSafe(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    if (normalized.startsWith('..') || normalized.startsWith('/') || normalized.includes('../')) {
      return false;
    }
    if (/[\x00-\x1f]/.test(normalized)) {
      return false;
    }
    if (/^[a-zA-Z]:[\\\/]/.test(normalized)) {
      return false;
    }
    return true;
  }

  private notify(): void {
    if (this.notifyTimeout !== null) {
      clearTimeout(this.notifyTimeout);
    }
    this.notifyTimeout = setTimeout(() => {
      this.notifyTimeout = null;
      const all = this.getAllChanges();
      for (const callback of this.callbacks) {
        try {
          callback(all);
        } catch {
          // Ignore callback errors
        }
      }
    }, 50);
  }
}

function computeDiffLines(original: string, updated: string): DiffLineState[] {
  const a = original.split(/\r?\n/);
  const b = updated.split(/\r?\n/);
  const n = a.length;
  const m = b.length;

  // Optimize by stripping common prefix and suffix
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }

  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  const result: DiffLineState[] = [];
  for (let i = 0; i < start; i++) {
    result.push({ line: a[i]!, type: 'unchanged' });
  }

  const subA = a.slice(start, endA + 1);
  const subB = b.slice(start, endB + 1);

  if (subA.length > 0 || subB.length > 0) {
    result.push(...myersDiff(subA, subB));
  }

  for (let i = endA + 1; i < n; i++) {
    result.push({ line: a[i]!, type: 'unchanged' });
  }

  return result;
}

/**
 * Computes the Shortest Edit Script (SES) using the Myers O(ND) algorithm.
 */
function myersDiff(a: string[], b: string[]): DiffLineState[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  if (n === 0) return b.map((line) => ({ line, type: 'added' }));
  if (m === 0) return a.map((line) => ({ line, type: 'removed' }));

  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  v[max + 1] = 0;

  let d = 0;
  let found = false;
  const MAX_D = 3000;

  // Forward pass
  for (; d <= max; d++) {
    if (d > MAX_D) {
      // Fallback to naive replacement to prevent hanging the UI on massive rewrites
      return [
        ...a.map((line) => ({ line, type: 'removed' as const })),
        ...b.map((line) => ({ line, type: 'added' as const }))
      ];
    }

    // Store only the calculated k-values for this step (highly memory optimized)
    const vStep = new Int32Array(2 * d + 1);

    for (let k = -d; k <= d; k += 2) {
      const kOffset = max + k;
      let x: number;

      if (k === -d || (k !== d && v[kOffset - 1]! < v[kOffset + 1]!)) {
        x = v[kOffset + 1]!; // Move down (insertion)
      } else {
        x = v[kOffset - 1]! + 1; // Move right (deletion)
      }

      let y = x - k;

      // Follow the diagonal (unchanged lines)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[kOffset] = x;
      vStep[k + d] = x;

      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }

    trace.push(vStep);
    if (found) break;
  }

  // Backtrack to build the diff
  const diff: DiffLineState[] = [];
  let x = n;
  let y = m;

  for (let step = d; step > 0; step--) {
    const k = x - y;
    const vStep = trace[step - 1]!;

    let prevK: number;
    if (k === -step || (k !== step && vStep[k + step - 2]! < vStep[k + step]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = vStep[prevK + step - 1]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      diff.push({ line: a[x]!, type: 'unchanged' });
    }

    if (x > prevX) {
      x--;
      diff.push({ line: a[x]!, type: 'removed' });
    } else if (y > prevY) {
      y--;
      diff.push({ line: b[y]!, type: 'added' });
    }
  }

  // Capture any remaining common lines back to origin
  while (x > 0 && y > 0) {
    x--;
    y--;
    diff.push({ line: a[x]!, type: 'unchanged' });
  }

  return diff.reverse();
}
