import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian module
vi.mock('obsidian', () => ({
  TFile: class TFile {
    extension = 'md';
    path = '';
    basename = '';
    stat = { size: 0, mtime: 0, ctime: 0 };
    constructor(path: string) {
      this.path = path;
      this.extension = path.split('.').pop() || 'md';
      this.basename = path.split('/').pop()?.replace(`.${this.extension}`, '') || '';
    }
  },
  TFolder: class TFolder {
    path = '';
    constructor(path: string) {
      this.path = path;
    }
  }
}));

import { getEnhancedNoteContext, getFolderContext } from '../utils/contextEnhancer.ts';

// Mock Plugin
const makeMockPlugin = () => {
  return {
    app: {
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue({
          frontmatter: {
            tags: ['tag1', 'tag2'],
            status: 'draft'
          },
          tags: [
            { tag: '#inline-tag' }
          ]
        })
      },
      vault: {
        getAbstractFileByPath: vi.fn(),
        getFiles: vi.fn(),
        read: vi.fn()
      }
    },
    debug: {
      error: vi.fn(),
      log: vi.fn()
    }
  } as unknown as Plugin;
};

describe('contextEnhancer', () => {
  describe('getEnhancedNoteContext', () => {
    it('should prefix note content with metadata block', async () => {
      const plugin = makeMockPlugin();
      const mockFile: any = {
        basename: 'test-note',
        extension: 'md',
        path: 'notes/test-note.md',
        stat: {
          ctime: 1715760000000,
          mtime: 1715763600000
        }
      };

      plugin.app.vault.read = vi.fn().mockResolvedValue('This is the note body content.');

      const result = await getEnhancedNoteContext(plugin, mockFile);

      expect(result).toContain('--- Note Metadata ---');
      expect(result).toContain('Path: notes/test-note.md');
      expect(result).toContain('Title: test-note');
      expect(result).toContain('Word Count: 6');
      expect(result).toContain('Tags: #inline-tag, tag1, tag2');
      expect(result).toContain('status": "draft"');
      expect(result).toContain('This is the note body content.');
    });
  });

  describe('getFolderContext', () => {
    it('should generate summary table of files in folder', async () => {
      const plugin = makeMockPlugin();
      const folderPath = 'projects';

      const mockFiles = [
        {
          extension: 'md',
          path: 'projects/proj1.md',
          stat: { ctime: 1715760000000, mtime: 1715760000000, size: 500 }
        },
        {
          extension: 'pdf',
          path: 'projects/spec.pdf',
          stat: { ctime: 1715760000000, mtime: 1715760000000, size: 12000 }
        }
      ];

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue({ path: folderPath });
      plugin.app.vault.getFiles = vi.fn().mockReturnValue(mockFiles);
      plugin.app.vault.read = vi.fn().mockResolvedValue('Project content.');

      const result = await getFolderContext(plugin, folderPath);

      expect(result).toContain('### 📂 Folder Context: projects');
      expect(result).toContain('Total Files: 2');
      expect(result).toContain('| projects/proj1.md | 500 |');
      expect(result).toContain('| projects/spec.pdf | 12000 |');
      expect(result).toContain('Contents of Top 1 Notes in Folder:');
      expect(result).toContain('Project content.');
    });
  });
});
