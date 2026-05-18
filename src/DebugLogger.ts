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
 * USAGE:
 *   const debug = new DebugLogger(plugin);
 *   debug.info('Connection established');
 *   debug.error('Failed to write file', error);
 */
export class DebugLogger {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get isEnabled(): boolean {
    return this.plugin.settings.enableDebugMode ?? false;
  }

  private format(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const argsStr = args.length > 0 ? ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') : '';
    return `[${timestamp}] [Hermes ${level}] ${message}${argsStr}`;
  }

  /** Detailed diagnostics — only shown when debug mode is on. */
  public debug(message: string, ...args: unknown[]): void {
    if (this.isEnabled) {
      console.debug(this.format('DEBUG', message, ...args));
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
}
