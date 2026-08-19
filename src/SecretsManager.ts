import { Notice } from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Secure storage for sensitive credentials.
 *
 * ARCHITECTURAL ROLE:
 * Hermes needs to store API keys and other secrets. We can't use plain
 * `localStorage` directly because:
 *   1. Keys would collide with other plugins or Obsidian itself
 *   2. There's no namespacing or scoping mechanism
 *   3. Secrets must not be stored in plaintext on disk
 *
 * SECURITY MODEL:
 * On desktop (this plugin is `isDesktopOnly`), secrets are encrypted with
 * Electron's `safeStorage` API before being persisted to Obsidian's
 * localStorage. `safeStorage` uses the OS keychain-backed encryption
 * (Keychain on macOS, DPAPI on Windows, libsecret on Linux), so the
 * ciphertext is only decryptable by the current OS user. This is the
 * canonical way to protect secrets in an Electron/Obsidian plugin.
 *
 * - Values are stored as `base64(ciphertext)` in localStorage.
 * - A `v1:` prefix marks safeStorage-encrypted values so we can detect and
 *   migrate legacy plaintext entries.
 * - If `safeStorage` is unavailable (e.g. a future mobile build), we fall
 *   back to plaintext localStorage and surface a prominent warning, because
 *   storing secrets in plaintext is a security downgrade the user must know
 *   about.
 *
 * MIGRATION:
 * On first `get()` of a legacy plaintext value, we transparently encrypt it
 * and re-save. This happens automatically so existing users are upgraded
 * without manual steps.
 *
 * DESIGN DECISIONS:
 * - Keys are prefixed with `${plugin.manifest.id}:` to avoid collisions.
 * - All methods are async so the storage backend can be swapped without
 *   changing call sites.
 * - `get()` returns empty string on failure so a missing secret doesn't
 *   crash the plugin on startup.
 * - `set()` shows a Notice on failure because the user needs to know their
 *   credentials weren't saved.
 */
export class SecretsManager {
  private readonly plugin: Plugin;
  private readonly prefix: string;
  /** Cached safeStorage handle, resolved lazily. */
  private safeStorage: SafeStorage | null | undefined;
  private warnedPlaintext = false;

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
    await Promise.resolve();
    try {
      const value: unknown = this.plugin.app.loadLocalStorage(fullKey);
      if (typeof value !== 'string' || value === '') {
        return '';
      }

      // Legacy plaintext value (no version prefix) — migrate to encrypted storage.
      if (!value.startsWith('v1:')) {
        const migrated = this.encryptValue(value);
        if (migrated !== null) {
          this.plugin.app.saveLocalStorage(fullKey, migrated);
        }
        return value;
      }

      const decrypted = this.decryptValue(value);
      return decrypted ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Remove a secret.
   */
  public remove(key: string): void {
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
    await Promise.resolve();
    try {
      const encrypted = this.encryptValue(value);
      this.plugin.app.saveLocalStorage(fullKey, encrypted ?? value);
    } catch {
      new Notice(`Failed to save secret: ${key}`);
    }
  }

  /**
   * Encrypt a plaintext value using Electron safeStorage.
   * Returns `null` if safeStorage is unavailable (falls back to plaintext).
   */
  private encryptValue(plaintext: string): null | string {
    const safeStorage = this.getSafeStorage();
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      this.warnPlaintextFallback();
      return null;
    }
    try {
      const buffer = safeStorage.encryptString(plaintext);
      return `v1:${Buffer.from(buffer).toString('base64')}`;
    } catch {
      this.warnPlaintextFallback();
      return null;
    }
  }

  /**
   * Decrypt a `v1:`-prefixed value using Electron safeStorage.
   * Returns `null` if decryption fails or safeStorage is unavailable.
   */
  private decryptValue(stored: string): null | string {
    const safeStorage = this.getSafeStorage();
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    try {
      const base64 = stored.slice('v1:'.length);
      const buffer = Buffer.from(base64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      return null;
    }
  }

  /**
   * Lazily resolve the Electron safeStorage handle.
   * Returns `null` when running outside Electron (e.g. tests or a future
   * mobile build).
   */
  private getSafeStorage(): SafeStorage | null {
    if (this.safeStorage !== undefined) {
      return this.safeStorage;
    }
    try {
      // Obsidian desktop exposes Electron's `require` on the renderer window.
      // `safeStorage` is available both directly and via the (deprecated)
      // `remote` module, so we probe both for forward compatibility.
      const electron = (
        window as unknown as { require?: (id: string) => unknown }
      ).require?.('electron');
      const remote = (
        electron as { remote?: { safeStorage?: SafeStorage } } | undefined
      )?.remote;
      const direct = (electron as { safeStorage?: SafeStorage } | undefined)
        ?.safeStorage;
      this.safeStorage = remote?.safeStorage ?? direct ?? null;
    } catch {
      this.safeStorage = null;
    }
    return this.safeStorage;
  }

  /**
   * Surface a one-time warning when secrets are stored in plaintext because
   * safeStorage is unavailable.
   */
  private warnPlaintextFallback(): void {
    if (this.warnedPlaintext) {
      return;
    }
    this.warnedPlaintext = true;
    new Notice(
      'Hermes: OS keychain encryption is unavailable. API keys will be stored in plaintext. Consider disabling API mode or using ACP mode.'
    );
  }
}

/**
 * Minimal structural type for Electron's `safeStorage` module.
 * We only use the subset of the API we need, so we don't depend on the
 * full Electron type definitions.
 */
interface SafeStorage {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  isEncryptionAvailable(): boolean;
}
