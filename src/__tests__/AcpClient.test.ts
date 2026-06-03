import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AcpClient } from '../AcpClient.ts';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian
vi.mock('obsidian', () => ({
  Notice: class Notice {
    message: string;
    constructor(message: string) { this.message = message; }
  },
  TFile: class TFile {
    extension = 'md';
    path = '';
    constructor(path: string) { this.path = path || ''; }
  },
}));

// Mock fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

// Mock child_process
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: vi.fn().mockReturnValue({
      killed: false,
      kill: vi.fn(),
      on: vi.fn(),
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn(), pipe: vi.fn() },
      stderr: { on: vi.fn() },
    }),
  };
});

// Mock @agentclientprotocol/sdk
const mockInitialize = vi.fn();
const mockAuthenticate = vi.fn();
const mockNewSession = vi.fn();
const mockCloseSession = vi.fn();
const mockPrompt = vi.fn();
const mockCancel = vi.fn();

vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    authenticate: mockAuthenticate,
    newSession: mockNewSession,
    closeSession: mockCloseSession,
    prompt: mockPrompt,
    cancel: mockCancel,
  })),
  ndJsonStream: vi.fn().mockReturnValue({
    readable: { getReader: vi.fn() },
    writable: { getWriter: vi.fn() },
  }),
}));

function createMockPlugin(overrides?: Partial<Plugin>): Plugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: vi.fn(),
        getRoot: vi.fn().mockReturnValue({ path: '/test/vault' }),
        read: vi.fn(),
      },
      workspace: {
        getActiveFile: vi.fn(),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
      },
    },
    auditLog: {
      record: vi.fn(),
      recordFileChange: vi.fn(),
      recordToolCall: vi.fn(),
      recordPermission: vi.fn(),
      recordTerminal: vi.fn(),
      recordConnection: vi.fn(),
      getRecentEntries: vi.fn().mockResolvedValue([]),
      flush: vi.fn().mockResolvedValue(undefined),
    },
    fileChangeManager: {
      registerChange: vi.fn().mockResolvedValue(undefined),
    },
    settings: {
      allowTerminal: false,
      hermesBinaryPath: '',
    },
    ...overrides,
  } as unknown as Plugin;
}

describe('AcpClient', () => {
  let plugin: Plugin;
  let acpClient: AcpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createMockPlugin();
    acpClient = new AcpClient(plugin);
  });

  describe('isReady', () => {
    it('should return false when not connected', () => {
      expect(acpClient.isReady()).toBe(false);
    });
  });

  describe('sendPrompt', () => {
    it('should throw when not connected', async () => {
      await expect(acpClient.sendPrompt('Hello')).rejects.toThrow('not connected');
    });
  });

  describe('cancel', () => {
    it('should not throw when not connected', async () => {
      await expect(acpClient.cancel()).resolves.not.toThrow();
    });
  });

  describe('permission handling', () => {
    it('should return empty pending permissions initially', () => {
      const permissions = acpClient.getPendingPermissions();
      expect(permissions).toEqual([]);
    });

    it('should support permission request subscriptions', () => {
      const callback = vi.fn();
      const unsubscribe = acpClient.onPermissionsChange(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should resolve permissions correctly', () => {
      const mockResolve = vi.fn();
      const mockReject = vi.fn();

      // Manually add a pending permission
      const pendingPermission = {
        id: 'test-perm-1',
        params: {
          options: [
            { kind: 'allow_once', name: 'Allow Once', optionId: 'allow1' },
          ],
          sessionId: 'session-1',
          toolCall: {},
        },
        reject: mockReject,
        resolve: mockResolve,
      };

      // Access private field through any cast for testing
      (acpClient as unknown as Record<string, unknown>)['pendingPermissions'] = [pendingPermission];

      acpClient.resolvePermission('test-perm-1', 'allow1');

      expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({
        outcome: expect.objectContaining({
          outcome: 'selected',
          optionId: 'allow1',
        })
      }));
    });

    it('should cancel permissions correctly', () => {
      const mockResolve = vi.fn();
      const mockReject = vi.fn();

      const pendingPermission = {
        id: 'test-perm-2',
        params: {
          options: [],
          sessionId: 'session-1',
          toolCall: {},
        },
        reject: mockReject,
        resolve: mockResolve,
      };

      (acpClient as unknown as Record<string, unknown>)['pendingPermissions'] = [pendingPermission];

      acpClient.cancelPermission('test-perm-2');

      expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({
        outcome: expect.objectContaining({
          outcome: 'cancelled',
        })
      }));
    });
  });

  describe('subscriptions', () => {
    it('should support update subscriptions', () => {
      const callback = vi.fn();
      const unsubscribe = acpClient.onUpdate(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should support error subscriptions', () => {
      const callback = vi.fn();
      const unsubscribe = acpClient.onError(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should support available commands subscriptions', () => {
      const callback = vi.fn();
      const unsubscribe = acpClient.onAvailableCommands(callback);

      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should immediately notify commands callback with cached commands', () => {
      const callback = vi.fn();

      // Set cached commands via internal state
      (acpClient as unknown as Record<string, unknown>)['lastAvailableCommands'] = [
        { description: 'Test command', name: 'test' },
      ];

      acpClient.onAvailableCommands(callback);

      expect(callback).toHaveBeenCalledWith([
        { description: 'Test command', name: 'test' },
      ]);
    });
  });

  describe('getLastAvailableCommands', () => {
    it('should return empty array initially', () => {
      expect(acpClient.getLastAvailableCommands()).toEqual([]);
    });
  });
});
