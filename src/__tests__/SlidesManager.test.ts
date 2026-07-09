import { describe, expect, it, vi } from 'vitest';
import { SlidesManager } from '../SlidesManager.ts';
import type { Plugin } from '../Plugin.ts';

vi.mock('obsidian', () => ({
  Notice: class Notice { constructor(public message: string) {} },
  TFile: class TFile {}
}));

const makeMockPlugin = () =>
  ({
    app: {
      commands: {
        executeCommandById: vi.fn().mockReturnValue(true)
      },
      workspace: {
        getLeavesOfType: vi.fn().mockReturnValue([]),
        getLeaf: vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) }),
        revealLeaf: vi.fn().mockResolvedValue(undefined)
      },
      vault: {
        read: vi.fn()
      }
    }
  }) as unknown as Plugin;

const makeFile = (path: string) => ({
  extension: path.split('.').pop() ?? 'md',
  path,
  basename: path.split('/').pop()?.replace(/\.\w+$/, '') ?? ''
} as any);

describe('SlidesManager', () => {
  describe('parseContent', () => {
    it('should return a single slide for content with no separators', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# Hello\n\nNo separators here.');
      expect(slides).toHaveLength(1);
      expect(slides[0]!.content).toBe('# Hello\n\nNo separators here.');
    });

    it('should split on --- separators', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# Slide 1\n\nContent 1\n\n---\n\n## Slide 2\n\nContent 2');
      expect(slides).toHaveLength(2);
      expect(slides[0]!.title).toBe('Slide 1');
      expect(slides[1]!.title).toBe('Slide 2');
    });

    it('should skip YAML frontmatter block', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const content = '---\ntitle: My Deck\n---\n# Actual Slide\n\nContent';
      const slides = manager.parseContent(content);
      expect(slides).toHaveLength(1);
      expect(slides[0]!.content).toContain('# Actual Slide');
      expect(slides[0]!.content).not.toContain('title: My Deck');
    });

    it('should extract slide title from first heading', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('## My Section\n\nSome text');
      expect(slides[0]!.title).toBe('My Section');
    });

    it('should set title to null when no heading is present', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('Just plain text, no heading.');
      expect(slides[0]!.title).toBeNull();
    });

    it('should filter out empty slides', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# Slide 1\n\n---\n\n---\n\n# Slide 2');
      // Middle empty slide should be filtered
      const nonEmpty = slides.filter((s) => s.content.length > 0);
      expect(nonEmpty).toHaveLength(2);
    });

    it('should track 0-indexed slide numbers', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# A\n\n---\n\n# B\n\n---\n\n# C');
      expect(slides[0]!.index).toBe(0);
      expect(slides[1]!.index).toBe(1);
      expect(slides[2]!.index).toBe(2);
    });
  });

  describe('formatSlidesForContext', () => {
    it('should include slide count and total chars', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# Title\n\nContent\n\n---\n\n## Section\n\nMore');
      const file = makeFile('my-deck.md');
      const result = manager.formatSlidesForContext(slides, file);
      expect(result).toContain('my-deck');
      expect(result).toContain('Total slides: 2');
    });

    it('should list each slide title', () => {
      const manager = new SlidesManager(makeMockPlugin());
      const slides = manager.parseContent('# Introduction\n\n---\n\n## Methods');
      const result = manager.formatSlidesForContext(slides, makeFile('deck.md'));
      expect(result).toContain('"Introduction"');
      expect(result).toContain('"Methods"');
    });
  });

  describe('generateSlidesFromNotes', () => {
    it('should start with a title slide and include note content', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue('## Note Section\n\nSome content.');
      const manager = new SlidesManager(plugin);
      const result = await manager.generateSlidesFromNotes(
        [makeFile('notes/note1.md')],
        'My Presentation'
      );
      expect(result).toContain('# My Presentation');
      expect(result).toContain('---');
      expect(result).toContain('Some content.');
    });

    it('should add note basename as heading when content lacks one', async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue('Plain content without heading.');
      const manager = new SlidesManager(plugin);
      const result = await manager.generateSlidesFromNotes(
        [makeFile('notes/my-note.md')],
        'Title'
      );
      expect(result).toContain('## my-note');
    });
  });
});
