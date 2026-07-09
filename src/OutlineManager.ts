import { MarkdownView, TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface HeadingItem {
  /** Heading level (1–6) */
  level: number;
  /** Heading text without the `#` prefix */
  text: string;
  /** Character offset of the heading in the file */
  position: number;
  /** Obsidian anchor slug (e.g. `my-heading`) */
  slug: string;
}

export interface BacklinkItem {
  /** The note that contains the link */
  sourcePath: string;
  /** Number of links from that note to this file */
  linkCount: number;
}

/**
 * Provides heading-tree outlines, backlinks, and heading navigation for vault notes.
 *
 * ARCHITECTURAL ROLE:
 * OutlineManager is a thin wrapper around `metadataCache`, surfacing the document
 * structure as first-class context for the Hermes agent. It adds zero file-I/O
 * overhead because headings are already indexed by Obsidian in the metadata cache.
 *
 * DESIGN DECISIONS:
 * - `getOutline()` reads directly from `metadataCache.getFileCache()` — no vault read required.
 * - `getBacklinks()` walks `metadataCache.resolvedLinks` in O(n) over the vault.
 * - `navigateToHeading()` uses the internal MarkdownView scroll API, requiring the
 *   view to already be open; it opens the file first if needed.
 */
export class OutlineManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Returns the heading tree for a file using the metadata cache.
   * Returns an empty array for non-markdown files or files with no headings.
   */
  public getOutline(file: TFile): HeadingItem[] {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache?.headings) {
      return [];
    }

    return cache.headings.map((h) => ({
      level: h.level,
      position: h.position.start.offset,
      slug: this.toSlug(h.heading),
      text: h.heading
    }));
  }

  /**
   * Renders the heading tree as an indented markdown list with anchor links.
   */
  public formatOutlineForContext(file: TFile): string {
    const headings = this.getOutline(file);
    if (headings.length === 0) {
      return '';
    }

    const lines: string[] = ['--- Document Outline ---'];
    for (const h of headings) {
      const indent = '  '.repeat(h.level - 1);
      lines.push(`${indent}${'#'.repeat(h.level)} ${h.text}`);
    }
    lines.push('------------------------');
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Returns all vault notes that contain at least one resolved link to the given file.
   */
  public getBacklinks(file: TFile): BacklinkItem[] {
    const resolvedLinks = this.plugin.app.metadataCache.resolvedLinks;
    const backlinks: BacklinkItem[] = [];

    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (sourcePath === file.path) {
        continue; // skip self-references
      }
      const linkCount = targets[file.path] ?? 0;
      if (linkCount > 0) {
        backlinks.push({ linkCount, sourcePath });
      }
    }

    return backlinks.sort((a, b) => b.linkCount - a.linkCount);
  }

  /**
   * Opens the file (if not already active) and scrolls the editor to the given heading.
   * Matching is case-insensitive and trims whitespace.
   */
  public async navigateToHeading(file: TFile, headingText: string): Promise<boolean> {
    const normalizedQuery = headingText.trim().toLowerCase();
    const headings = this.getOutline(file);
    const match = headings.find((h) => h.text.toLowerCase() === normalizedQuery);
    if (!match) {
      return false;
    }

    // Ensure the file is open in a MarkdownView
    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return false;
    }

    // Scroll to heading position using the editor's line-based API
    const editor = view.editor;
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      const line = editor.getLine(i);
      if (line.toLowerCase().includes(normalizedQuery) && line.startsWith('#')) {
        editor.setCursor({ ch: 0, line: i });
        editor.scrollIntoView({ from: { ch: 0, line: i }, to: { ch: 0, line: i } }, true);
        break;
      }
    }

    return true;
  }

  /**
   * Converts a heading string to an Obsidian anchor slug.
   * Lowercases, replaces spaces with hyphens, strips non-alphanumeric characters.
   */
  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
}
