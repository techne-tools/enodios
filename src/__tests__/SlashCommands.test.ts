import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  clearToolCache,
  getSlashCommands,
  getToolSlashCommands,
  parseSlashCommand,
  registerSlashCommand,
  setCachedToolCommands,
  unregisterSlashCommand
} from '../SlashCommands.ts';
import type { Plugin } from '../Plugin.ts';

// Mock obsidian module since SlashCommands imports TFile from it
vi.mock('obsidian', () => ({
  TFile: class TFile {
    extension = 'md';
    path = '';
    constructor(path: string) {
      this.path = path;
    }
  }
}));

describe('SlashCommands', () => {
  beforeEach(() => {
    // Clear custom and cached commands between tests
    clearToolCache();
    // Unregister any custom commands that might have been added
    const commands = getSlashCommands();
    for (const cmd of commands) {
      // Only unregister custom commands (not built-in)
      if (!['clear', 'context', 'help'].includes(cmd.name)) {
        unregisterSlashCommand(cmd.name);
      }
    }
  });

  describe('getSlashCommands', () => {
    it('should return built-in commands', () => {
      const commands = getSlashCommands();
      const names = commands.map((c) => c.name);

      expect(names).toContain('clear');
      expect(names).toContain('context');
      expect(names).toContain('help');
    });

    it('should deduplicate commands by name (built-in takes precedence)', () => {
      // Register a custom command with same name as built-in
      registerSlashCommand({
        description: 'Custom clear',
        execute: async () => 'custom',
        name: 'clear'
      });

      const commands = getSlashCommands();
      const clearCmd = commands.find((c) => c.name === 'clear');

      expect(clearCmd?.description).toBe('Clear the current conversation');
    });

    it('should include cached tool commands', () => {
      setCachedToolCommands([
        {
          description: 'Tool command',
          execute: async () => null,
          name: 'tool-cmd'
        }
      ]);

      const commands = getSlashCommands();
      const names = commands.map((c) => c.name);

      expect(names).toContain('tool-cmd');
    });
  });

  describe('registerSlashCommand', () => {
    it('should add custom commands to the registry', () => {
      registerSlashCommand({
        description: 'Custom command',
        execute: async () => 'result',
        name: 'custom'
      });

      const commands = getSlashCommands();
      const names = commands.map((c) => c.name);

      expect(names).toContain('custom');
    });
  });

  describe('unregisterSlashCommand', () => {
    it('should remove a custom command by name', () => {
      registerSlashCommand({
        description: 'To be removed',
        execute: async () => null,
        name: 'remove-me'
      });

      expect(getSlashCommands().some((c) => c.name === 'remove-me')).toBe(true);

      unregisterSlashCommand('remove-me');

      expect(getSlashCommands().some((c) => c.name === 'remove-me')).toBe(false);
    });

    it('should not affect built-in commands', () => {
      unregisterSlashCommand('clear');

      const commands = getSlashCommands();
      expect(commands.some((c) => c.name === 'clear')).toBe(true);
    });
  });

  describe('setCachedToolCommands / clearToolCache', () => {
    it('should cache tool commands', async () => {
      setCachedToolCommands([
        {
          description: 'Tool 1',
          execute: async () => null,
          name: 'tool1'
        }
      ]);

      const toolCmds = await getToolSlashCommands({} as Plugin);
      expect(toolCmds).toHaveLength(1);
      expect(toolCmds[0]?.name).toBe('tool1');
    });

    it('should clear cached tool commands', async () => {
      setCachedToolCommands([
        {
          description: 'Tool 1',
          execute: async () => null,
          name: 'tool1'
        }
      ]);

      clearToolCache();

      const toolCmds = await getToolSlashCommands({} as Plugin);
      expect(toolCmds).toHaveLength(0);
    });
  });

  describe('parseSlashCommand', () => {
    it('should parse a simple slash command', () => {
      const result = parseSlashCommand('/help');

      expect(result).not.toBeNull();
      expect(result?.command.name).toBe('help');
      expect(result?.args).toBe('');
    });

    it('should parse a slash command with arguments', () => {
      const result = parseSlashCommand('/context some args here');

      expect(result).not.toBeNull();
      expect(result?.command.name).toBe('context');
      expect(result?.args).toBe('some args here');
    });

    it('should return null for messages without slash prefix', () => {
      const result = parseSlashCommand('hello world');
      expect(result).toBeNull();
    });

    it('should return null for unknown commands', () => {
      const result = parseSlashCommand('/unknown');
      expect(result).toBeNull();
    });

    it('should handle commands with extra whitespace', () => {
      const result = parseSlashCommand('  /clear  ');

      expect(result).not.toBeNull();
      expect(result?.command.name).toBe('clear');
    });

    it('should parse cached tool commands', () => {
      setCachedToolCommands([
        {
          description: 'A tool',
          execute: async () => null,
          name: 'my-tool'
        }
      ]);

      const result = parseSlashCommand('/my-tool arg1 arg2');

      expect(result).not.toBeNull();
      expect(result?.command.name).toBe('my-tool');
      expect(result?.args).toBe('arg1 arg2');
    });
  });

  describe('search command (Local RAG)', () => {
    let mockPlugin: Plugin;

    beforeEach(() => {
      mockPlugin = {
        app: {
          vault: {
            getMarkdownFiles: vi.fn().mockReturnValue([]),
            cachedRead: vi.fn().mockResolvedValue(''),
          }
        }
      } as unknown as Plugin;
    });

    it('should require a search query', async () => {
      const searchCmd = getSlashCommands().find((c) => c.name === 'search')!;
      const result = await searchCmd.execute(mockPlugin, '   ');
      expect(result).toBe('Please provide a search query. Example: `/search project goals`');
    });

    it('should return a message if no files match', async () => {
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([{ path: 'file1.md' }]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue('Some unrelated content');

      const searchCmd = getSlashCommands().find((c) => c.name === 'search')!;
      const result = await searchCmd.execute(mockPlugin, 'secret');
      expect(result).toBe('No vault notes found matching "secret".');
    });

    it('should score and sort matches correctly', async () => {
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([
        { path: 'file1.md' },
        { path: 'file2.md' },
        { path: 'file3.md' }
      ]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockImplementation(async (file) => {
        if (file.path === 'file1.md') return 'Only one term matches secret.';
        if (file.path === 'file2.md') return 'Two terms match secret project.';
        if (file.path === 'file3.md') return 'No terms match.';
        return '';
      });

      const searchCmd = getSlashCommands().find((c) => c.name === 'search')!;
      const result = await searchCmd.execute(mockPlugin, 'secret project');

      // Check that both matching files are in the result
      expect(result).toContain('file1.md');
      expect(result).toContain('file2.md');
      expect(result).not.toContain('file3.md');

      // Check sorting: file2.md (score 2) should appear before file1.md (score 1)
      expect(result?.indexOf('file2.md')).toBeLessThan(result!.indexOf('file1.md'));
    });

    it('should extract and format excerpts with ellipses', async () => {
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([{ path: 'long.md' }]);

      // Create a string of 400 characters
      const prefix = 'A'.repeat(100);
      const match = ' SECRET ';
      const suffix = 'B'.repeat(300);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue(prefix + match + suffix);

      const searchCmd = getSlashCommands().find((c) => c.name === 'search')!;
      const result = await searchCmd.execute(mockPlugin, 'secret');

      expect(result).toContain('**Path:** `long.md`');
      expect(result).toMatch(/\.\.\.A+ SECRET B+\.\.\./);
    });

    it('should replace newlines in the excerpt with spaces', async () => {
      mockPlugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue([{ path: 'newlines.md' }]);
      mockPlugin.app.vault.cachedRead = vi.fn().mockResolvedValue('Line 1\nLine 2\nSECRET\nLine 3\nLine 4');

      const searchCmd = getSlashCommands().find((c) => c.name === 'search')!;
      const result = await searchCmd.execute(mockPlugin, 'secret');

      expect(result).toContain('Line 1 Line 2 SECRET Line 3 Line 4');
      expect(result).not.toContain('\nLine 2');
    });
  });

  describe('git & admonition commands', () => {
    let mockPlugin: Plugin;

    beforeEach(() => {
      mockPlugin = {
        communityPluginsManager: {
          runGitPush: vi.fn().mockReturnValue('Git push result'),
          insertAdmonition: vi.fn().mockReturnValue('Admonition inserted')
        }
      } as unknown as Plugin;
    });

    it('should delegate /git push to communityPluginsManager.runGitPush', async () => {
      const gitCmd = getSlashCommands().find((c) => c.name === 'git')!;
      const result = await gitCmd.execute(mockPlugin, 'push');
      expect(mockPlugin.communityPluginsManager.runGitPush).toHaveBeenCalled();
      expect(result).toBe('Git push result');
    });

    it('should require a type for /admonition insert', async () => {
      const admCmd = getSlashCommands().find((c) => c.name === 'admonition')!;
      const result = await admCmd.execute(mockPlugin, 'insert');
      expect(result).toBe('Please specify a type. Example: `/admonition insert note`');
    });

    it('should delegate /admonition insert to communityPluginsManager.insertAdmonition', async () => {
      const admCmd = getSlashCommands().find((c) => c.name === 'admonition')!;
      const result = await admCmd.execute(mockPlugin, 'insert note My Title');
      expect(mockPlugin.communityPluginsManager.insertAdmonition).toHaveBeenCalledWith('note', 'My Title');
      expect(result).toBe('Admonition inserted');
    });
  });

  describe('table command', () => {
    let mockPlugin: Plugin;

    beforeEach(() => {
      mockPlugin = {
        communityPluginsManager: {
          generateTable: vi.fn().mockReturnValue('Table generated'),
          formatTable: vi.fn().mockReturnValue('Table formatted')
        }
      } as unknown as Plugin;
    });

    it('should delegate /table generate to communityPluginsManager.generateTable', async () => {
      const tableCmd = getSlashCommands().find((c) => c.name === 'table')!;
      const result = await tableCmd.execute(mockPlugin, 'generate 4 5');
      expect(mockPlugin.communityPluginsManager.generateTable).toHaveBeenCalledWith('4', '5');
      expect(result).toBe('Table generated');
    });

    it('should delegate /table format to communityPluginsManager.formatTable', async () => {
      const tableCmd = getSlashCommands().find((c) => c.name === 'table')!;
      const result = await tableCmd.execute(mockPlugin, 'format');
      expect(mockPlugin.communityPluginsManager.formatTable).toHaveBeenCalled();
      expect(result).toBe('Table formatted');
    });

    it('should return usage string when subcommand is unrecognized', async () => {
      const tableCmd = getSlashCommands().find((c) => c.name === 'table')!;
      const result = await tableCmd.execute(mockPlugin, '');
      expect(result).toBe('Usage:\n* `/table generate`\n* `/table format`');
    });
  });
});
