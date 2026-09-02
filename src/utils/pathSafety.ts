import { normalizePath } from "obsidian";

import type { Plugin } from "../Plugin.ts";

/**
 * Shared vault path-containment validation.
 *
 * SECURITY:
 * The agent must never read, write, or delete files outside the vault. This
 * module provides a single, authoritative check used by both ACP and API
 * modes. It rejects:
 *   - Absolute paths
 *   - Parent-directory traversal (`..`)
 *   - Null bytes and control characters
 *   - Windows drive-letter and UNC paths
 *   - Symlinks that resolve outside the vault (via `fs.realpath`)
 *
 * The symlink check is the critical hardening: a symlink inside the vault
 * pointing at `~/.ssh` or `../` would otherwise allow the agent to escape
 * the vault. We resolve the real path and verify it stays under the vault
 * base path.
 */

/**
 * Basic lexical path-safety check (no filesystem access).
 * Rejects traversal, absolute paths, control characters, and Windows paths.
 */
export function isLexicallySafePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (
    normalized.startsWith("..") ||
    normalized.startsWith("/") ||
    normalized.includes("../")
  ) {
    return false;
  }
  // Reject null bytes and control characters
  if (/[\u0000-\u001f]/.test(normalized)) {
    return false;
  }
  // Reject Windows absolute paths
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    return false;
  }
  // Reject UNC paths (Windows network shares)
  if (normalized.startsWith("\\\\")) {
    return false;
  }
  return true;
}

/**
 * Full path-safety check including symlink resolution.
 * Returns `true` if the path is lexically safe AND resolves to a location
 * inside the vault base path.
 *
 * @param plugin The plugin instance (to resolve the vault base path).
 * @param filePath The vault-relative path to validate.
 */
export async function isPathSafe(
  plugin: Plugin,
  filePath: string
): Promise<boolean> {
  if (!isLexicallySafePath(filePath)) {
    return false;
  }

  // Resolve the vault base path on the filesystem.
  // Duck-typed (not `instanceof`) so tests with plain-object adapters work.
  const adapter = plugin.app.vault.adapter as {
    getBasePath?: () => string;
  } | null;
  const basePath = adapter?.getBasePath?.() ?? "";
  if (!basePath) {
    // If we can't determine the base path, fall back to lexical safety only.
    return true;
  }

  try {
    const { realpath } = await import("fs/promises");
    const vaultRoot = await realpath(basePath);
    const candidate = await realpath(
      `${vaultRoot}/${normalizePath(filePath)}`
    ).catch(() => null);
    if (candidate === null) {
      // The file may not exist yet (e.g. a create). Check the parent directory.
      const parent = filePath.split("/").slice(0, -1).join("/");
      if (!parent) {
        return true;
      }
      const parentReal = await realpath(
        `${vaultRoot}/${normalizePath(parent)}`
      ).catch(() => null);
      if (parentReal === null) {
        return true;
      }
      return parentReal === vaultRoot || parentReal.startsWith(`${vaultRoot}/`);
    }
    return candidate === vaultRoot || candidate.startsWith(`${vaultRoot}/`);
  } catch {
    // If realpath fails for any reason, fall back to lexical safety.
    return true;
  }
}
