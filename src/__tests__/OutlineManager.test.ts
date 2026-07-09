import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';
import { OutlineManager } from '../OutlineManager.ts';

vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {}
}));

const makeMockPlugin = (overrides: Partial<Plugin> = {}) =>
  ({
    app: {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
        resolvedLinks: {}
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue(null),
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn() })
      }
    },
    ...overrides
  }) as unknown as Plugin;

const makeMockFile = (path = 'notes/test.md') => ({
  extension: 'md',
  path,
  basename: path.split('/').pop()?.replace('.md', '') ?? 'test',
  stat: { size: 0, mtime: 0, ctime: 0 }
} as any);

describe('OutlineManager', () => {
  describe('getOutline', () => {
    it('should return empty array when file has no headings', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({ headings: undefined });
      const manager = new OutlineManager(plugin);
      const result = manager.getOutline(makeMockFile());
      expect(result).toEqual([]);
    });

    it('should return empty array when cache is null', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue(null);
      const manager = new OutlineManager(plugin);
      expect(manager.getOutline(makeMockFile())).toEqual([]);
    });

    it('should return headings from metadata cache', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
        headings: [
          { level: 1, heading: 'Introduction', position: { start: { offset: 0 } } },
          { level: 2, heading: 'Background', position: { start: { offset: 15 } } },
          { level: 3, heading: 'Prior Work', position: { start: { offset: 30 } } }
        ]
      });
      const manager = new OutlineManager(plugin);
      const result = manager.getOutline(makeMockFile());
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({ level: 1, text: 'Introduction', slug: 'introduction' });
      expect(result[1]).toMatchObject({ level: 2, text: 'Background', slug: 'background' });
      expect(result[2]).toMatchObject({ level: 3, text: 'Prior Work', slug: 'prior-work' });
    });
  });

  describe('formatOutlineForContext', () => {
    it('should return empty string for file with no headings', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({ headings: [] });
      const manager = new OutlineManager(plugin);
      expect(manager.formatOutlineForContext(makeMockFile())).toBe('');
    });

    it('should format headings as indented outline', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
        headings: [
          { level: 1, heading: 'Title', position: { start: { offset: 0 } } },
          { level: 2, heading: 'Section', position: { start: { offset: 10 } } }
        ]
      });
      const manager = new OutlineManager(plugin);
      const result = manager.formatOutlineForContext(makeMockFile());
      expect(result).toContain('--- Document Outline ---');
      expect(result).toContain('# Title');
      expect(result).toContain('  ## Section');
    });
  });

  describe('getBacklinks', () => {
    it('should return empty array when no links point to the file', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache as any).resolvedLinks = {
        'other/note.md': { 'unrelated.md': 1 }
      };
      const manager = new OutlineManager(plugin);
      const result = manager.getBacklinks(makeMockFile('notes/test.md'));
      expect(result).toEqual([]);
    });

    it('should return backlinks sorted by count descending', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache as any).resolvedLinks = {
        'note-a.md': { 'notes/test.md': 3 },
        'note-b.md': { 'notes/test.md': 1 },
        'note-c.md': { 'notes/test.md': 5 }
      };
      const manager = new OutlineManager(plugin);
      const result = manager.getBacklinks(makeMockFile('notes/test.md'));
      expect(result).toHaveLength(3);
      expect(result[0]!.linkCount).toBe(5);
      expect(result[0]!.sourcePath).toBe('note-c.md');
      expect(result[1]!.linkCount).toBe(3);
      expect(result[2]!.linkCount).toBe(1);
    });

    it('should exclude self-references', () => {
      const plugin = makeMockPlugin();
      (plugin.app.metadataCache as any).resolvedLinks = {
        'notes/test.md': { 'notes/test.md': 2 }
      };
      const manager = new OutlineManager(plugin);
      const result = manager.getBacklinks(makeMockFile('notes/test.md'));
      expect(result).toEqual([]);
    });
  });
});
