import {
  Notice,
  TFile
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface Slide {
  /** 0-indexed slide number */
  index: number;
  /** First heading found in the slide, if any */
  title: string | null;
  /** Full slide content (trimmed) */
  content: string;
  /** Character length of the slide */
  charCount: number;
}

/**
 * Manages Obsidian Slides presentations (Reveal.js-flavoured markdown).
 *
 * ARCHITECTURAL ROLE:
 * SlidesManager lets the Hermes agent understand, generate, and present slide
 * decks. Slides in Obsidian are standard `.md` files where slides are separated
 * by `---` horizontal rule boundaries. The agent can produce a slides file from
 * note context and can trigger Obsidian's built-in Slides presentation mode.
 *
 * DESIGN DECISIONS:
 * - `parseSlides()` splits on `\n---\n` (with optional surrounding blank lines)
 *   to correctly handle frontmatter `---` delimiters (the first `---` block is
 *   treated as YAML frontmatter and skipped).
 * - `openPresentationMode()` uses the undocumented-but-stable internal plugin
 *   command ID `slides:start`. A graceful fallback Notice is shown if Slides
 *   is not enabled.
 * - `generateSlidesFromNotes()` uses `##` heading level for individual slide titles
 *   to avoid conflicting with the deck's `#` title slide.
 */
export class SlidesManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Splits a note's content into individual slides.
   * The YAML frontmatter block (if present) is excluded from the slides.
   */
  public async parseSlides(file: TFile): Promise<Slide[]> {
    const content = await this.plugin.app.vault.read(file);
    return this.parseContent(content);
  }

  /**
   * Parses raw markdown content into slides. Pure function for testability.
   */
  public parseContent(content: string): Slide[] {
    const normalized = content.replace(/\r\n/g, '\n');
    // Strip leading frontmatter block
    let body = normalized;
    if (body.startsWith('---\n')) {
      const closingIdx = body.indexOf('\n---\n', 4);
      if (closingIdx !== -1) {
        body = body.slice(closingIdx + 5);
      }
    }

    // Split on `---` slide separators (allow surrounding blank lines)
    const rawSlides = body.split(/\n\s*---\s*\n/);

    return rawSlides
      .map((raw, idx) => {
        const trimmed = raw.trim();
        const titleMatch = /^#{1,6}\s+(.+)$/m.exec(trimmed);
        return {
          charCount: trimmed.length,
          content: trimmed,
          index: idx,
          title: titleMatch ? (titleMatch[1] ?? null) : null
        };
      })
      .filter((s) => s.content.length > 0);
  }

  /**
   * @param sources - TFile array in the order they should appear in the output.
   * @param title - The title of the presentation.
   */
  public async generateSlidesFromNotes(
    sources: TFile[],
    title: string
  ): Promise<string> {
    const sections: string[] = [`# ${title}`];

    for (const file of sources) {
      const content = await this.plugin.app.vault.read(file);
      const normalized = content.replace(/\r\n/g, '\n');
      // Strip frontmatter
      let body = normalized;
      if (body.startsWith('---\n')) {
        const closingIdx = body.indexOf('\n---\n', 4);
        if (closingIdx !== -1) {
          body = body.slice(closingIdx + 5);
        }
      }
      // Use note basename as slide heading if content doesn't already start with one
      const startsWithHeading = /^#{1,6}\s/.test(body.trimStart());
      const slideContent = startsWithHeading
        ? body.trim()
        : `## ${file.basename}\n\n${body.trim()}`;
      sections.push(slideContent);
    }

    return sections.join('\n\n---\n\n') + '\n';
  }

  /**
   * Formats a slides array as a context summary for the Hermes agent.
   */
  public formatSlidesForContext(slides: Slide[], file: TFile): string {
    const totalChars = slides.reduce((acc, s) => acc + s.charCount, 0);
    const lines = [
      `--- Slides: ${file.basename} ---`,
      `Total slides: ${String(slides.length)} (${String(totalChars)} total characters)`,
      ''
    ];

    for (const slide of slides) {
      const title = slide.title ?? '(no title)';
      lines.push(
        `  Slide ${String(slide.index + 1)}: "${title}" — ${String(slide.charCount)} chars`
      );
    }

    lines.push('', '------------------------------');
    return lines.join('\n');
  }

  /**
   * Opens the active note (or the given file) in Obsidian Slides presentation mode.
   * Triggers the internal `slides:start` command. Shows a Notice if the Slides
   * core plugin is not enabled.
   */
  public async openPresentationMode(file: TFile): Promise<void> {
    const { app } = this.plugin;

    // Reveal the file first in a markdown leaf
    const leaves = app.workspace.getLeavesOfType('markdown');
    const targetLeaf = leaves.find(
      (l) => (l.view as { file?: TFile }).file?.path === file.path
    );

    if (!targetLeaf) {
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } else {
      await app.workspace.revealLeaf(targetLeaf);
    }

    // Small delay to let the view render before triggering presentation mode
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });

    // Try triggering Obsidian's built-in Slides command
    const commandsApp = app as unknown as {
      commands?: { executeCommandById(id: string): boolean };
    };
    const executed = commandsApp.commands?.executeCommandById('slides:start');

    if (!executed) {
      new Notice(
        'Slides core plugin does not appear to be enabled. Enable it in Settings → Core plugins → Slides.'
      );
    }
  }
}
