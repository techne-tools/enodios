import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../Plugin.ts';
import { NoteTemplateManager } from '../NoteTemplateManager.ts';

vi.mock('obsidian', () => ({
  Notice: class Notice { constructor(public message: string) {} },
  TFile: class TFile {}
}));

const makeMockPlugin = (templatesFolder = 'Templates') =>
  ({
    app: {
      internalPlugins: {
        plugins: {
          templates: {
            enabled: true,
            instance: { options: { folder: templatesFolder } }
          }
        }
      },
      vault: {
        getMarkdownFiles: vi.fn().mockReturnValue([]),
        modify: vi.fn().mockResolvedValue(undefined),
        read: vi.fn().mockResolvedValue('')
      }
    },
    debug: { error: vi.fn() },
    settings: {
      noteTemplatesFolder: ''
    }
  }) as unknown as Plugin;

const makeFile = (path: string) => ({
  extension: path.split('.').pop() ?? 'md',
  path,
  basename: path.split('/').pop()?.replace(/\.\w+$/, '') ?? ''
} as any);

describe('NoteTemplateManager', () => {
  describe('getTemplatesFolder', () => {
    it('should read folder from Obsidian internal plugin config', () => {
      const plugin = makeMockPlugin('My Templates');
      const manager = new NoteTemplateManager(plugin);
      expect(manager.getTemplatesFolder()).toBe('My Templates');
    });

    it('should return the Hermes settings override when set', () => {
      const plugin = makeMockPlugin('My Templates');
      (plugin.settings as any).noteTemplatesFolder = 'Custom Templates';
      const manager = new NoteTemplateManager(plugin);
      expect(manager.getTemplatesFolder()).toBe('Custom Templates');
    });

    it('should return null when templates plugin is disabled', () => {
      const plugin = makeMockPlugin();
      (plugin.app as any).internalPlugins.plugins.templates.enabled = false;
      const manager = new NoteTemplateManager(plugin);
      expect(manager.getTemplatesFolder()).toBeNull();
    });

    it('should return null when internal plugins are unavailable', () => {
      const plugin = makeMockPlugin();
      (plugin.app as any).internalPlugins = undefined;
      const manager = new NoteTemplateManager(plugin);
      expect(manager.getTemplatesFolder()).toBeNull();
    });
  });

  describe('listNoteTemplates', () => {
    it('should return empty array when no templates folder is configured', () => {
      const plugin = makeMockPlugin();
      (plugin.app as any).internalPlugins.plugins.templates.enabled = false;
      const manager = new NoteTemplateManager(plugin);
      expect(manager.listNoteTemplates()).toEqual([]);
    });

    it('should return only files inside the templates folder', () => {
      const plugin = makeMockPlugin('Templates');
      (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([
        makeFile('Templates/Meeting Notes.md'),
        makeFile('Templates/Daily Journal.md'),
        makeFile('other/folder/not-a-template.md')
      ]);
      const manager = new NoteTemplateManager(plugin);
      const result = manager.listNoteTemplates();
      expect(result).toHaveLength(2);
      expect(result.map((f: any) => f.basename)).toContain('Meeting Notes');
    });
  });

  describe('findTemplate', () => {
    it('should find a template by exact name (case-insensitive)', () => {
      const plugin = makeMockPlugin('Templates');
      (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([
        makeFile('Templates/Weekly Review.md')
      ]);
      const manager = new NoteTemplateManager(plugin);
      expect(manager.findTemplate('weekly review')).not.toBeNull();
      expect(manager.findTemplate('WEEKLY REVIEW')).not.toBeNull();
    });

    it('should return null when template is not found', () => {
      const plugin = makeMockPlugin('Templates');
      (plugin.app.vault.getMarkdownFiles as any).mockReturnValue([]);
      const manager = new NoteTemplateManager(plugin);
      expect(manager.findTemplate('Nonexistent')).toBeNull();
    });
  });

  describe('insertTemplate', () => {
    it('should append template content to the target note', async () => {
      const plugin = makeMockPlugin('Templates');
      (plugin.app.vault.read as any)
        .mockResolvedValueOnce('# Template Content')  // template read
        .mockResolvedValueOnce('Existing note content.\n');  // target read

      const manager = new NoteTemplateManager(plugin);
      await manager.insertTemplate(
        makeFile('Templates/My Template.md'),
        makeFile('notes/current-note.md')
      );

      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('# Template Content')
      );
    });
  });

  describe('formatTemplatesListForContext', () => {
    it('should return a no-templates message when list is empty', () => {
      const plugin = makeMockPlugin();
      const manager = new NoteTemplateManager(plugin);
      const result = manager.formatTemplatesListForContext([]);
      expect(result).toContain('No note templates found');
    });

    it('should list template names and paths', () => {
      const plugin = makeMockPlugin();
      const manager = new NoteTemplateManager(plugin);
      const templates = [makeFile('Templates/Meeting Notes.md'), makeFile('Templates/Daily.md')];
      const result = manager.formatTemplatesListForContext(templates);
      expect(result).toContain('Meeting Notes');
      expect(result).toContain('Daily');
      expect(result).toContain('/note-template insert');
    });
  });
});
