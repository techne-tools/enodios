import { Notice } from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Secure storage for sensitive credentials using Obsidian's localStorage API.
 *
 * Keys are scoped to this plugin to avoid collisions.
 */
export class SecretsManager {
  private readonly plugin: Plugin;
  private readonly prefix: string;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.prefix = `${plugin.manifest.id}:`;
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
}
