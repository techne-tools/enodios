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

import { TemplateManager } from '../TemplateManager.ts';

describe('TemplateManager', () => {
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = {
      app: {
        vault: {
          getAbstractFileByPath: vi.fn(),
          getFiles: vi.fn(),
          read: vi.fn(),
          createFolder: vi.fn(),
          create: vi.fn(),
          modify: vi.fn()
        },
        metadataCache: {
          getFileCache: vi.fn()
        }
      },
      debug: {
        error: vi.fn(),
        log: vi.fn()
      }
    };
  });

  describe('loadTemplates', () => {
    it('should return built-in templates by default when folder does not exist', async () => {
      const manager = new TemplateManager(mockPlugin as Plugin);
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

      const templates = await manager.loadTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(4);
      expect(templates.map(t => t.id)).toContain('lit-review');
    });

    it('should load custom templates from hermes/templates folder and strip YAML frontmatter', async () => {
      const manager = new TemplateManager(mockPlugin as Plugin);
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue({ path: 'hermes/templates' });

      const file1 = { path: 'hermes/templates/custom1.md', extension: 'md', basename: 'custom1' };
      mockPlugin.app.vault.getFiles.mockReturnValue([file1]);

      mockPlugin.app.vault.read.mockResolvedValue(`---
name: Custom Coding Guide
icon: 🚀
description: Guides developer on coding tasks.
---
This is the custom prompt template body.
`);

      mockPlugin.app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: {
          name: 'Custom Coding Guide',
          icon: '🚀',
          description: 'Guides developer on coding tasks.'
        }
      });

      const templates = await manager.loadTemplates();
      expect(templates.length).toBe(5); // 4 built-ins + 1 custom
      const custom = templates.find((t) => t.id === 'custom-custom1');
      expect(custom).toBeDefined();
      expect(custom?.name).toBe('Custom Coding Guide');
      expect(custom?.icon).toBe('🚀');
      expect(custom?.prompt).toBe('This is the custom prompt template body.');
    });
  });

  describe('saveTemplate', () => {
    it('should create template folder and write template markdown file in vault', async () => {
      const manager = new TemplateManager(mockPlugin as Plugin);

      // Folder exists false first, then true
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

      await manager.saveTemplate('My Custom Coach', 'This is custom coach body', '🧠', 'Coaching prompt');

      expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledWith('hermes/templates');
      expect(mockPlugin.app.vault.create).toHaveBeenCalledWith(
        'hermes/templates/my-custom-coach.md',
        expect.stringContaining('name: My Custom Coach')
      );
      expect(mockPlugin.app.vault.create).toHaveBeenCalledWith(
        'hermes/templates/my-custom-coach.md',
        expect.stringContaining('This is custom coach body')
      );
    });
  });
});
