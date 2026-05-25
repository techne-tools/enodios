import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FileChangeManager } from '../FileChangeManager.ts';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian
vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {
    file = null;
    editor = { cm: null };
  },
  Notice: class Notice {
    constructor(public message: string) {}
  },
  TFile: class TFile {
    extension = 'md';
    path = '';
    constructor(path?: string) {
      if (path) this.path = path;
    }
  },
  normalizePath: (path: string) => path.replace(/\\/g, '/'),
}));

function createMockPlugin(): Plugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: vi.fn(),
        read: vi.fn().mockResolvedValue(''),
        create: vi.fn().mockResolvedValue(undefined),
        modify: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue(null),
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
    vaultManager: {
      ensureFolderExists: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Plugin;
}

describe('FileChangeManager', () => {
  let plugin: Plugin;
  let manager: FileChangeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createMockPlugin();
    manager = new FileChangeManager(plugin);
  });

  describe('registerChange', () => {
    it('should throw on path traversal attempts', async () => {
      await expect(manager.registerChange('../outside.md', 'content')).rejects.toThrow('Invalid file path');
      await expect(manager.registerChange('/root.md', 'content')).rejects.toThrow('Invalid file path');
    });

    it('should correctly assign "create" action for new files', async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      const change = await manager.registerChange('new.md', 'content');

      expect(change.action).toBe('create');
      expect(change.status).toBe('pending');
    });

    it('should correctly assign "modify" action for existing files', async () => {
      const { TFile } = await import('obsidian');
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(new TFile('existing.md'));
      plugin.app.vault.read = vi.fn().mockResolvedValue('old content');

      const change = await manager.registerChange('existing.md', 'new content');

      expect(change.action).toBe('modify');
      expect(change.originalContent).toBe('old content');
    });

    it('should correctly assign "delete" action when content is null', async () => {
      const change = await manager.registerChange('todelete.md', null);
      expect(change.action).toBe('delete');
    });
  });

  describe('approveChange', () => {
    it('should create new files and ensure parent folders exist', async () => {
      const change = await manager.registerChange('folder/new.md', 'content');
      await manager.approveChange(change.id);

      expect(plugin.vaultManager.ensureFolderExists).toHaveBeenCalledWith('folder');
      expect(plugin.app.vault.create).toHaveBeenCalledWith('folder/new.md', 'content');
      expect(manager.getPendingChanges()).toHaveLength(0);
    });

    it('should modify existing files', async () => {
      const { TFile } = await import('obsidian');
      const existingFile = new TFile('existing.md');
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(existingFile);
      plugin.app.vault.read = vi.fn().mockResolvedValue('old content');

      const change = await manager.registerChange('existing.md', 'new content');
      await manager.approveChange(change.id);

      expect(plugin.app.vault.modify).toHaveBeenCalledWith(existingFile, 'new content');
      expect(manager.getAllChanges()[0]?.status).toBe('approved');
    });

    it('should trash deleted files', async () => {
      const { TFile } = await import('obsidian');
      const existingFile = new TFile('todelete.md');
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(existingFile);

      const change = await manager.registerChange('todelete.md', null);
      await manager.approveChange(change.id);

      expect(plugin.app.vault.trash).toHaveBeenCalledWith(existingFile, true);
    });
  });

  describe('reject actions and clear', () => {
    it('should reject a single change without writing', async () => {
      const change = await manager.registerChange('test.md', 'content');
      manager.rejectChange(change.id);

      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(manager.getPendingChanges()).toHaveLength(0);
      expect(manager.getAllChanges()[0]?.status).toBe('rejected');
    });

    it('should reject all changes', async () => {
      await manager.registerChange('test1.md', 'content');
      await manager.registerChange('test2.md', 'content');

      manager.rejectAll();

      expect(manager.getPendingChanges()).toHaveLength(0);
      expect(manager.getAllChanges().every(c => c.status === 'rejected')).toBe(true);
    });

    it('should clear resolved changes from history', async () => {
      const change1 = await manager.registerChange('test1.md', 'content');
      await manager.registerChange('test2.md', 'content');

      manager.rejectChange(change1.id); // Resolve one
      expect(manager.getAllChanges()).toHaveLength(2);

      manager.clearResolved();
      expect(manager.getAllChanges()).toHaveLength(1);
      expect(manager.getAllChanges()[0]?.status).toBe('pending');
    });
  });

  describe('concurrency locks', () => {
    it('should prevent concurrent approveChange calls for the same path', async () => {
      let createCalls = 0;
      plugin.app.vault.create = vi.fn().mockImplementation(async () => {
        createCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const change = await manager.registerChange('test.md', 'content');

      // Execute concurrently
      await Promise.all([
        manager.approveChange(change.id),
        manager.approveChange(change.id),
      ]);

      // The vault.create should only be triggered once due to processingPaths lock
      expect(createCalls).toBe(1);
    });

    it('should prevent concurrent approveAll calls', async () => {
      let createCalls = 0;
      plugin.app.vault.create = vi.fn().mockImplementation(async () => {
        createCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      await manager.registerChange('test1.md', 'content 1');
      await manager.registerChange('test2.md', 'content 2');

      // Execute concurrently
      await Promise.all([
        manager.approveAll(),
        manager.approveAll(),
      ]);

      // Should only process the queue once, resulting in exactly 2 create calls
      // instead of potentially triggering 4 or causing overlapping errors.
      expect(createCalls).toBe(2);
    });
  });
});
