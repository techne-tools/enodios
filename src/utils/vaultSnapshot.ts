import type { TFile } from "obsidian";

import type { Plugin } from "../Plugin.ts";

/**
 * Vault snapshotting for the API-mode file-approval proxy.
 *
 * ARCHITECTURAL ROLE:
 * In API mode, the Hermes agent runs on a remote server and writes files
 * directly to the vault via its native tools (`write_file`, `patch`, etc.).
 * The plugin cannot intercept those writes in real time. To restore the
 * human-in-the-loop safety guarantee that ACP mode provides, we snapshot the
 * vault before each prompt turn, diff it after the turn, and route every
 * detected change through `FileChangeManager` for user approval. On reject,
 * the change is reverted to the snapshot content.
 *
 * MEMORY BOUNDS:
 * - Files larger than `MAX_FILE_SIZE` are skipped (their content is not
 *   snapshotted, so they cannot be reverted — a deliberate trade-off).
 * - Total snapshot size is capped at `MAX_TOTAL_BYTES` to avoid exhausting
 *   memory on very large vaults.
 */
export interface VaultSnapshotEntry {
  content: string;
  mtime: number;
  path: string;
  size: number;
}

export interface VaultSnapshot {
  entries: Map<string, VaultSnapshotEntry>;
}

export interface VaultChange {
  action: "create" | "delete" | "modify";
  newContent: null | string;
  originalContent: string;
  path: string;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024; // Skip files larger than 2MB.
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // Cap total snapshot at 50MB.

/**
 * Capture a snapshot of the vault's text-file contents.
 * Files that are too large or unreadable are skipped.
 */
export async function captureVaultSnapshot(
  plugin: Plugin
): Promise<VaultSnapshot> {
  const entries = new Map<string, VaultSnapshotEntry>();
  let total = 0;

  for (const file of plugin.app.vault.getFiles()) {
    if (file.stat.size > MAX_FILE_SIZE) {
      continue;
    }
    if (total + file.stat.size > MAX_TOTAL_BYTES) {
      break;
    }
    try {
      const content = await plugin.app.vault.read(file);
      entries.set(file.path, {
        content,
        mtime: file.stat.mtime,
        path: file.path,
        size: file.stat.size
      });
      total += content.length;
    } catch {
      // Skip unreadable files.
    }
  }

  return { entries };
}

/**
 * Diff a snapshot against the current vault state.
 * Returns the set of created, modified, and deleted files.
 */
export async function diffVaultSnapshot(
  snapshot: VaultSnapshot,
  plugin: Plugin
): Promise<VaultChange[]> {
  const changes: VaultChange[] = [];
  const currentFiles = new Map<string, TFile>(
    plugin.app.vault.getFiles().map((f) => [f.path, f])
  );

  // Deleted files.
  for (const [path, entry] of snapshot.entries) {
    if (!currentFiles.has(path)) {
      changes.push({
        action: "delete",
        newContent: null,
        originalContent: entry.content,
        path
      });
    }
  }

  // Created / modified files.
  for (const [path, file] of currentFiles) {
    const snapshotEntry = snapshot.entries.get(path);
    if (!snapshotEntry) {
      // New file.
      try {
        const content = await plugin.app.vault.read(file);
        changes.push({
          action: "create",
          newContent: content,
          originalContent: "",
          path
        });
      } catch {
        // Skip unreadable files.
      }
    } else if (
      file.stat.mtime !== snapshotEntry.mtime ||
      file.stat.size !== snapshotEntry.size
    ) {
      // Modified file.
      try {
        const content = await plugin.app.vault.read(file);
        changes.push({
          action: "modify",
          newContent: content,
          originalContent: snapshotEntry.content,
          path
        });
      } catch {
        // Skip unreadable files.
      }
    }
  }

  return changes;
}
