import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DebugLogger } from '../DebugLogger.ts';
import type { Plugin } from '../Plugin.ts';

function createMockPlugin(debugEnabled = false): Plugin {
  return {
    settings: {
      enableDebugMode: debugEnabled,
    },
  } as unknown as Plugin;
}

describe('DebugLogger', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when debug mode is OFF', () => {
    it('should NOT log debug messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.debug('test message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should NOT log info messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.info('test message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should NOT log warn messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.warn('test message');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should ALWAYS log error messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.error('test message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should NOT output anything for group when debug is off', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.group('group label', () => {
        logger.debug('inside group');
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should still execute group callback even when debug is off', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      let executed = false;
      logger.group('group label', () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });
  });

  describe('when debug mode is ON', () => {
    it('should log debug messages with [Hermes DEBUG] prefix', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.debug('test message');
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes DEBUG]');
      expect(call).toContain('test message');
    });

    it('should log info messages with [Hermes INFO] prefix', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.info('test message');
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes INFO]');
      expect(call).toContain('test message');
    });

    it('should log warn messages with [Hermes WARN] prefix', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.warn('test message');
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes WARN]');
      expect(call).toContain('test message');
    });

    it('should log error messages with [Hermes ERROR] prefix', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.error('test message');
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
      const call = consoleErrorSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes ERROR]');
      expect(call).toContain('test message');
    });

    it('should include extra arguments in log output', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.debug('message with data', { key: 'value' }, 42);
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      expect(call).toContain('{"key":"value"}');
      expect(call).toContain('42');
    });

    it('should output a group line and execute the callback', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      let executed = false;
      logger.group('group label', () => {
        executed = true;
      });
      expect(executed).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes GROUP]');
      expect(call).toContain('group label');
    });

    it('should still execute the callback if it throws and propagate the error', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      expect(() => {
        logger.group('group label', () => {
          throw new Error('boom');
        });
      }).toThrow('boom');
      expect(consoleWarnSpy).toHaveBeenCalledOnce();
    });

    it('should include ISO timestamp in log output', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.info('timestamp test');
      const call = consoleWarnSpy.mock.calls[0]![0] as string;
      // ISO timestamp format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });
  });
});
