import type { Plugin } from './Plugin.ts';

/**
 * Centralized debug logging utility.
 *
 * WHY THIS EXISTS:
 * During early development, things break constantly. Raw console.log calls
 * clutter the output and can't be toggled by users. This wrapper:
 * - Respects the `enableDebugMode` setting (off by default)
 * - Prefixes all messages with [Hermes] for easy filtering
 * - Provides log levels (debug, info, warn, error)
 * - Can be extended to write to a file or the audit log in the future
 *
 * ARCHITECTURAL ROLE:
 * Every major subsystem (AcpClient, HermesApiClient, FileChangeManager,
 * VaultManager) receives a DebugLogger instance. This ensures consistent
 * formatting and gives users a single toggle to control verbosity.
 *
 * DESIGN DECISION: `error()` is ALWAYS shown, even when debug mode is off,
 * because errors represent broken functionality that users need to know about.
 * All other levels are gated by `enableDebugMode` to keep the console clean
 * during normal use.
 *
 * USAGE:
 *   const debug = new DebugLogger(plugin);
 *   debug.info('Connection established');
 *   debug.error('Failed to write file', error);
 */
export class DebugLogger {
  private readonly plugin: Plugin;

  private get isEnabled(): boolean {
    return this.plugin.settings.enableDebugMode ?? false;
  }

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /** Detailed diagnostics — only shown when debug mode is on. */
  public debug(message: string, ...args: unknown[]): void {
    if (this.isEnabled) {
      console.debug(this.format('DEBUG', message, ...args));
    }
  }

  /** Errors — ALWAYS shown, even when debug mode is off, because errors matter. */
  public error(message: string, ...args: unknown[]): void {
    console.error(this.format('ERROR', message, ...args));
  }

  /** Group related logs together. Only outputs if debug mode is on. */
  public group(label: string, fn: () => void): void {
    if (this.isEnabled) {
      console.group(this.format('DEBUG', label));
      try {
        fn();
      } finally {
        console.groupEnd();
      }
    } else {
      fn();
    }
  }

  /** General information — only shown when debug mode is on. */
  public info(message: string, ...args: unknown[]): void {
    if (this.isEnabled) {
      console.info(this.format('INFO', message, ...args));
    }
  }

  /** Warnings — only shown when debug mode is on. */
  public warn(message: string, ...args: unknown[]): void {
    if (this.isEnabled) {
      console.warn(this.format('WARN', message, ...args));
    }
  }

  private format(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const argsStr = args.length > 0 ? ` ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}` : '';
    return this.redactSecrets(`[${timestamp}] [Hermes ${level}] ${message}${argsStr}`);
  }

  /**
   * Redact common secret patterns from log strings to prevent accidental
   * credential exposure in debug output.
   *
   * SECURITY NOTE: This is a best-effort heuristic. It catches common patterns
   * like Bearer tokens and API keys, but may miss custom secret formats.
   * Debug output should still be treated as potentially sensitive.
   */
  private redactSecrets(text: string): string {
    // Redact Bearer tokens: "Bearer abc123..." → "Bearer [REDACTED]"
    let redacted = text.replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]');
    // Redact API keys in query strings: "api_key=abc123" → "api_key=[REDACTED]"
    redacted = redacted.replace(/(api[_-]?key=)\S+/gi, '$1[REDACTED]');
    // Redact Authorization headers: "Authorization: Basic abc123" → "Authorization: [REDACTED]"
    redacted = redacted.replace(/(Authorization:\s*\w+\s+)\S+/gi, '$1[REDACTED]');
    // Redact password fields in JSON: "password": "secret" → "password": "[REDACTED]"
    redacted = redacted.replace(/("password"\s*:\s*")[^"]*/gi, '$1[REDACTED]');
    return redacted;
  }
}
