import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';
import { BasesManager } from '../BasesManager.ts';

// Mock obsidian module including parseYaml/stringifyYaml
vi.mock('obsidian', () => ({
  Notice: class Notice { constructor(public message: string) {} },
  TFile: class TFile {},
  parseYaml: (str: string) => {
    // Minimal YAML parse for test purposes
    const result: Record<string, unknown> = {};
    for (const line of str.split('\n')) {
      const match = /^(\w+):\s*(.+)$/.exec(line.trim());
      if (match) { result[match[1]!] = match[2]; }
    }
    return result;
  },
  stringifyYaml: (obj: unknown) => JSON.stringify(obj)
}));

const makeMockPlugin = () =>
  ({
    app: {
      vault: {
        create: vi.fn().mockResolvedValue({ path: 'test.base' }),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        getFiles: vi.fn().mockReturnValue([]),
        modify: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue('')
      }
    },
    debug: { error: vi.fn() }
  }) as unknown as Plugin;

const makeFile = (path: string) => ({
  extension: path.split('.').pop() ?? 'md',
  path,
  basename: path.split('/').pop()?.replace(/\.\w+$/, '') ?? ''
} as any);

describe('BasesManager', () => {
  describe('listBases', () => {
    it('should return only .base files', () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getFiles as any).mockReturnValue([
        makeFile('projects.base'),
        makeFile('notes.md'),
        makeFile('canvas.canvas'),
        makeFile('books.base')
      ]);
      const manager = new BasesManager(plugin);
      const result = manager.listBases();
      expect(result).toHaveLength(2);
      expect(result.map((f: any) => f.path)).toContain('projects.base');
    });

    it('should return empty array when no .base files exist', () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getFiles as any).mockReturnValue([makeFile('note.md')]);
      const manager = new BasesManager(plugin);
      expect(manager.listBases()).toHaveLength(0);
    });
  });

  describe('parseBase', () => {
    it('should return null for non-base files', async () => {
      const plugin = makeMockPlugin();
      const manager = new BasesManager(plugin);
      const result = await manager.parseBase(makeFile('test.md'));
      expect(result).toBeNull();
    });

    it('should return null on read/parse error', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockRejectedValue(new Error('Read failed'));
      const manager = new BasesManager(plugin);
      const result = await manager.parseBase(makeFile('test.base'));
      expect(result).toBeNull();
      expect(plugin.debug.error).toHaveBeenCalled();
    });
  });

  describe('formatBaseForContext', () => {
    it('should show view count and types', () => {
      const plugin = makeMockPlugin();
      const manager = new BasesManager(plugin);
      const base = {
        views: [
          { type: 'table' as const, name: 'All Notes', order: ['file.name', 'status'] },
          { type: 'cards' as const, name: 'Card View' }
        ]
      };
      const result = manager.formatBaseForContext(base, makeFile('my.base'));
      expect(result).toContain('Base: my');
      expect(result).toContain('Views (2):');
      expect(result).toContain('[table] All Notes');
      expect(result).toContain('[cards] Card View');
      expect(result).toContain('columns: file.name, status');
    });

    it('should handle bases with no views', () => {
      const plugin = makeMockPlugin();
      const manager = new BasesManager(plugin);
      const result = manager.formatBaseForContext({}, makeFile('empty.base'));
      expect(result).toContain('Views: none defined');
    });

    it('should show formula names when present', () => {
      const plugin = makeMockPlugin();
      const manager = new BasesManager(plugin);
      const base = { formulas: { age: 'now() - date', score: 'priority * 10' } };
      const result = manager.formatBaseForContext(base, makeFile('formulas.base'));
      expect(result).toContain('Formulas: age, score');
    });
  });
});
