import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian module
vi.mock('obsidian', () => ({
  TFile: class TFile {
    extension = 'md';
    path = '';
    basename = '';
    constructor(path: string) {
      this.path = path;
      this.basename = path.split('/').pop()?.replace('.md', '') || '';
    }
  }
}));

import { TagManager } from '../TagManager.ts';

describe('TagManager', () => {
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = {
      app: {
        vault: {
          getMarkdownFiles: vi.fn(),
        },
        metadataCache: {
          getFileCache: vi.fn(),
        },
        fileManager: {
          processFrontMatter: vi.fn()
        }
      }
    };
  });

  describe('getAllVaultTagsWithCounts', () => {
    it('should aggregate inline and frontmatter tags across markdown files', () => {
      const manager = new TagManager(mockPlugin as Plugin);

      const file1 = { path: 'notes/1.md' };
      const file2 = { path: 'notes/2.md' };
      mockPlugin.app.vault.getMarkdownFiles.mockReturnValue([file1, file2]);

      mockPlugin.app.metadataCache.getFileCache.mockImplementation((file: any) => {
        if (file.path === 'notes/1.md') {
          return {
            tags: [{ tag: '#academic' }, { tag: '#writing' }],
            frontmatter: { tags: ['research', 'study'] }
          };
        }
        if (file.path === 'notes/2.md') {
          return {
            tags: [{ tag: '#writing' }],
            frontmatter: { tag: 'study' } // single tag field
          };
        }
        return null;
      });

      const counts = manager.getAllVaultTagsWithCounts();
      expect(counts).toEqual({
        '#academic': 1,
        '#writing': 2,
        '#research': 1,
        '#study': 2
      });
    });
  });

  describe('suggestTagsForContent', () => {
    it('should score and suggest relevant tags based on title/body keywords', () => {
      const manager = new TagManager(mockPlugin as Plugin);

      // Seed vault tags
      vi.spyOn(manager, 'getAllVaultTagsWithCounts').mockReturnValue({
        '#academic/writing': 2,
        '#javascript': 1,
        '#python': 3,
        '#studying': 1
      });

      const title = 'A study on academic writing in JavaScript';
      const body = 'This note discusses studying JavaScript and why it is great for writing web apps.';

      const suggestions = manager.suggestTagsForContent(body, title);
      expect(suggestions).toHaveLength(3);

      // Hierarchical tags parts ('academic' and 'writing') match title words -> high confidence
      expect(suggestions[0]).toEqual({
        tag: '#academic/writing',
        confidence: 0.85
      });

      // 'javascript' matches title words -> high confidence
      expect(suggestions[1]).toEqual({
        tag: '#javascript',
        confidence: 0.85
      });

      // 'studying' matches first paragraph body snippet words -> medium confidence
      expect(suggestions[2]).toEqual({
        tag: '#studying',
        confidence: 0.65
      });
    });
  });

  describe('applyTagsToNote', () => {
    it('should invoke processFrontMatter and append new unique tags', async () => {
      const manager = new TagManager(mockPlugin as Plugin);
      const mockFile: any = { basename: 'test' };

      mockPlugin.app.fileManager.processFrontMatter.mockImplementation(async (file: any, cb: any) => {
        const fm = { tags: ['old-tag'] };
        await cb(fm);
        expect(fm.tags).toEqual(['old-tag', 'new-tag1', 'new-tag2']);
      });

      await manager.applyTagsToNote(mockFile, ['#new-tag1', 'new-tag2']);
      expect(mockPlugin.app.fileManager.processFrontMatter).toHaveBeenCalledWith(mockFile, expect.any(Function));
    });
  });
});
