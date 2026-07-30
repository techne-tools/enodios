import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Plugin } from '../Plugin.ts';
import { CommunityPluginsManager } from '../CommunityPluginsManager.ts';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

vi.mock('obsidian', () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {}
}));

describe('CommunityPluginsManager - Git Push & Admonition', () => {
  let mockPlugin: Plugin;
  let manager: CommunityPluginsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlugin = {
      app: {
        vault: {
          adapter: {
            getBasePath: vi.fn().mockReturnValue('/mock/vault/path')
          }
        },
        workspace: {
          getActiveViewOfType: vi.fn()
        }
      }
    } as unknown as Plugin;
    manager = new CommunityPluginsManager(mockPlugin);
  });

  describe('runGitPush', () => {
    it('should return vault path error if getBasePath returns empty', () => {
      (mockPlugin.app.vault.adapter as any).getBasePath = vi.fn().mockReturnValue('');
      const result = manager.runGitPush();
      expect(result).toBe('Unable to determine vault path for git execution.');
    });

    it('should execute git push and return formatted output on success', () => {
      (execSync as any).mockReturnValue('Everything up-to-date\n');
      const result = manager.runGitPush();
      expect(execSync).toHaveBeenCalledWith('git push', {
        cwd: '/mock/vault/path',
        encoding: 'utf-8'
      });
      expect(result).toBe('### 🚀 Git Push\n\n```text\nEverything up-to-date\n\n```');
    });

    it('should return default text if git push returns empty output', () => {
      (execSync as any).mockReturnValue('');
      const result = manager.runGitPush();
      expect(result).toBe('### 🚀 Git Push\n\n```text\nSuccess (no output)\n```');
    });

    it('should catch error and return failed message if execSync throws', () => {
      (execSync as any).mockImplementation(() => {
        throw new Error('Could not resolve host');
      });
      const result = manager.runGitPush();
      expect(result).toBe('Git push failed: Could not resolve host');
    });
  });

  describe('insertAdmonition', () => {
    it('should return error message if no active note editor found', () => {
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(null);
      const result = manager.insertAdmonition('note');
      expect(result).toBe('No active note editor found. Open a note first.');
    });

    it('should insert admonition without title at cursor', () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: 'MyNote' }
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(mockActiveView);

      const result = manager.insertAdmonition('note');
      expect(mockReplaceSelection).toHaveBeenCalledWith('>  [!note]\n> \n');
      expect(result).toBe('Inserted **note** Admonition at cursor in **MyNote**.');
    });

    it('should insert admonition with title at cursor', () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: 'MyNote' }
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(mockActiveView);

      const result = manager.insertAdmonition('warning', 'Important Warning');
      expect(mockReplaceSelection).toHaveBeenCalledWith('>  [!warning] Important Warning\n> \n');
      expect(result).toBe('Inserted **warning** Admonition at cursor in **MyNote**.');
    });
  });
});
