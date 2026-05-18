import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupSpy: ReturnType<typeof vi.spyOn>;
  let consoleGroupEndSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleGroupSpy = vi.spyOn(console, 'group').mockImplementation(() => {});
    consoleGroupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when debug mode is OFF', () => {
    it('should NOT log debug messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.debug('test message');
      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('should NOT log info messages', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.info('test message');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
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

    it('should NOT open console group', () => {
      const plugin = createMockPlugin(false);
      const logger = new DebugLogger(plugin);
      logger.group('group label', () => {
        logger.debug('inside group');
      });
      expect(consoleGroupSpy).not.toHaveBeenCalled();
      expect(consoleGroupEndSpy).not.toHaveBeenCalled();
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
      expect(consoleDebugSpy).toHaveBeenCalledOnce();
      const call = consoleDebugSpy.mock.calls[0]![0] as string;
      expect(call).toContain('[Hermes DEBUG]');
      expect(call).toContain('test message');
    });

    it('should log info messages with [Hermes INFO] prefix', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.info('test message');
      expect(consoleInfoSpy).toHaveBeenCalledOnce();
      const call = consoleInfoSpy.mock.calls[0]![0] as string;
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
      expect(consoleDebugSpy).toHaveBeenCalledOnce();
      const call = consoleDebugSpy.mock.calls[0]![0] as string;
      expect(call).toContain('{"key":"value"}');
      expect(call).toContain('42');
    });

    it('should open and close console group', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.group('group label', () => {
        logger.debug('inside group');
      });
      expect(consoleGroupSpy).toHaveBeenCalledOnce();
      expect(consoleGroupEndSpy).toHaveBeenCalledOnce();
    });

    it('should still close group if callback throws', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      expect(() => {
        logger.group('group label', () => {
          throw new Error('boom');
        });
      }).toThrow('boom');
      expect(consoleGroupEndSpy).toHaveBeenCalledOnce();
    });

    it('should include ISO timestamp in log output', () => {
      const plugin = createMockPlugin(true);
      const logger = new DebugLogger(plugin);
      logger.info('timestamp test');
      const call = consoleInfoSpy.mock.calls[0]![0] as string;
      // ISO timestamp format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(call).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });
  });
});
