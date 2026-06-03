import { Notice } from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Secure storage for sensitive credentials using Obsidian's localStorage API.
 *
 * ARCHITECTURAL ROLE:
 * Hermes needs to store API keys and other secrets. We can't use plain
 * `localStorage` directly because:
 *   1. Keys would collide with other plugins or Obsidian itself
 *   2. There's no namespacing or scoping mechanism
 *   3. Future migration to a more secure store (e.g. OS keychain) would
 *      require changing every call site
 *
 * DESIGN DECISIONS:
 * - Keys are prefixed with `${plugin.manifest.id}:` to avoid collisions.
 * - All methods are async so we can swap localStorage for an async
 *   backend (e.g. electron safeStorage) without changing call sites.
 * - Errors are swallowed (return empty string) for `get()` so that a
 *   missing secret doesn't crash the plugin on startup.
 * - `set()` shows a Notice on failure because the user needs to know
 *   their credentials weren't saved.
 *
 * SECURITY WARNING: localStorage is NOT encrypted. Secrets are stored in
 * PLAINTEXT in the user's profile directory (e.g., on macOS:
 * ~/Library/Application Support/Obsidian/obsidian-localStorage.json).
 * Any process with user privileges can read this file. API keys are
 * revokable, which mitigates the risk, but users should:
 *   1. Rotate API keys regularly
 *   2. Not store non-revokable credentials (passwords, private keys) here
 *   3. Be cautious when syncing their Obsidian profile to cloud services
 *
 * FUTURE WORK: Migrate to Electron's safeStorage API or OS keychain for
 * actual encrypted storage.
 */
export class SecretsManager {
  private readonly plugin: Plugin;
  private readonly prefix: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.prefix = `${plugin.manifest.id}:`;
  }

  /**
   * Retrieve a secret value.
   * Returns empty string if not found.
   */
  public async get(key: string): Promise<string> {
    const fullKey = `${this.prefix}${key}`;
    try {
      const value = this.plugin.app.loadLocalStorage(fullKey);
      return value ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Remove a secret.
   */
  public async remove(key: string): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    try {
      this.plugin.app.saveLocalStorage(fullKey, '');
    } catch {
      // Ignore removal errors
    }
  }

  /**
   * Save a secret value securely.
   */
  public async set(key: string, value: string): Promise<void> {
    const fullKey = `${this.prefix}${key}`;
    try {
      this.plugin.app.saveLocalStorage(fullKey, value);
    } catch {
      new Notice(`Failed to save secret: ${key}`);
    }
  }
}
