import {
  Notice,
  TFile
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface ComposeSplitResult {
  /** The new note created from the extracted section */
  created: TFile;
  /** The original note, now containing an embed */
  modified: TFile;
}

/**
 * Implements Note Composer-style split and merge operations for vault notes.
 *
 * ARCHITECTURAL ROLE:
 * NoteComposerManager provides programmatic access to the two most common
 * structural operations on Obsidian notes: splitting a note at a heading
 * boundary (creating a new child note and replacing the section with an embed),
 * and merging multiple notes into a single destination file.
 *
 * DESIGN DECISIONS:
 * - `splitNoteAtHeading()` replaces the extracted section with a `![[embed]]`
 *   so the original reading view is preserved.
 * - Heading matching is case-insensitive and matches the first occurrence.
 * - `mergeNotes()` concatenates in the order provided, separated by `---` and a
 *   source link header, then moves the sources to trash (non-destructive default).
 * - All file operations go through `vault.modify()` and `vault.create()` rather
 *   than the FileChangeManager flow, because these are direct user-triggered
 *   operations (not agent suggestions) that don't require diff approval.
 */
export class NoteComposerManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Splits the content under `headingText` out of `file` into a new note.
   * The original note's section is replaced with a `![[newNote]]` embed.
   *
   * Returns the created file and modified original, or null on failure.
   */
  public async splitNoteAtHeading(
    file: TFile,
    headingText: string
  ): Promise<ComposeSplitResult | null> {
    const content = await this.plugin.app.vault.read(file);
    const lines = content.split('\n');

    const normalizedQuery = headingText.trim().toLowerCase();
    let headingLineIdx = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lines[i] ?? '');
      if (match && (match[2] ?? '').toLowerCase() === normalizedQuery) {
        headingLineIdx = i;
        headingLevel = match[1]!.length;
        break;
      }
    }

    if (headingLineIdx === -1) {
      new Notice(`Heading "${headingText}" not found in ${file.basename}.`);
      return null;
    }

    // Find the end of this heading's section (next heading of same or higher level)
    let sectionEndIdx = lines.length;
    for (let i = headingLineIdx + 1; i < lines.length; i++) {
      const match = /^(#{1,6})\s+/.exec(lines[i] ?? '');
      if (match && match[1]!.length <= headingLevel) {
        sectionEndIdx = i;
        break;
      }
    }

    const extractedLines = lines.slice(headingLineIdx, sectionEndIdx);
    const remainingLines = [
      ...lines.slice(0, headingLineIdx),
      `![[${headingText}]]`,
      ...lines.slice(sectionEndIdx)
    ];

    // Create the new note from extracted content
    const newPath = this.resolveNewPath(file, headingText);
    const existingNew = this.plugin.app.vault.getAbstractFileByPath(newPath);
    if (existingNew instanceof TFile) {
      new Notice(`A note already exists at ${newPath}. Aborting split.`);
      return null;
    }

    const created = await this.plugin.app.vault.create(
      newPath,
      extractedLines.join('\n').trimEnd() + '\n'
    );

    await this.plugin.app.vault.modify(
      file,
      remainingLines.join('\n').replace(/\n{3,}/g, '\n\n')
    );

    return { created, modified: file };
  }

  /**
   * Merges the content of multiple source notes into a single destination note.
   * Each source is separated by a `---` rule and a source attribution header.
   * Source files are moved to the system trash after merging (non-destructive).
   *
   * @param sources - TFile array in the order they should appear in the output.
   * @param destinationPath - Vault-relative path for the merged note (must not exist).
   * @param deleteSources - If true (default), moves source files to trash after merge.
   */
  public async mergeNotes(
    sources: TFile[],
    destinationPath: string,
    deleteSources = true
  ): Promise<TFile | null> {
    if (sources.length === 0) {
      new Notice('No source notes provided for merge.');
      return null;
    }

    const existingDest = this.plugin.app.vault.getAbstractFileByPath(destinationPath);
    if (existingDest instanceof TFile) {
      new Notice(`Destination note already exists: ${destinationPath}`);
      return null;
    }

    const sections: string[] = [];
    for (const source of sources) {
      const sourceContent = await this.plugin.app.vault.read(source);
      sections.push(
        `> [!note] Merged from [[${source.basename}]]\n\n${sourceContent.trim()}`
      );
    }

    const mergedContent = sections.join('\n\n---\n\n') + '\n';

    // Ensure parent folder exists
    const parts = destinationPath.split('/');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      await this.ensureFolderExists(parentPath);
    }

    const destination = await this.plugin.app.vault.create(
      destinationPath,
      mergedContent
    );

    if (deleteSources) {
      for (const source of sources) {
        await this.plugin.app.fileManager.trashFile(source);
      }
    }

    return destination;
  }

  /**
   * Extracts a character range from `file` into a new note and replaces it
   * with a `![[embed]]`. Primarily used by the "Extract selection" editor command.
   */
  public async extractSelection(
    file: TFile,
    fromChar: number,
    toChar: number,
    newPath: string
  ): Promise<TFile | null> {
    const content = await this.plugin.app.vault.read(file);
    if (fromChar < 0 || toChar > content.length || fromChar >= toChar) {
      new Notice('Invalid selection range for extraction.');
      return null;
    }

    const existingNew = this.plugin.app.vault.getAbstractFileByPath(newPath);
    if (existingNew instanceof TFile) {
      new Notice(`A note already exists at ${newPath}. Aborting extraction.`);
      return null;
    }

    const extracted = content.slice(fromChar, toChar);
    const newBasename = newPath.split('/').pop()?.replace(/\.md$/, '') ?? 'Extracted';
    const remaining = content.slice(0, fromChar)
      + `![[${newBasename}]]`
      + content.slice(toChar);

    const created = await this.plugin.app.vault.create(newPath, extracted.trim() + '\n');
    await this.plugin.app.vault.modify(file, remaining);

    return created;
  }

  /** Resolves a sibling path for a split note in the same folder as the source. */
  private resolveNewPath(source: TFile, headingText: string): string {
    const dir = source.parent?.path ?? '';
    const slug = headingText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const name = slug || 'extracted';
    return dir ? `${dir}/${name}.md` : `${name}.md`;
  }

  /** Recursively creates folder segments if they do not exist. */
  private async ensureFolderExists(path: string): Promise<void> {
    const segments = path.split('/');
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const exists = this.plugin.app.vault.getAbstractFileByPath(current);
      if (!exists) {
        try {
          await this.plugin.app.vault.createFolder(current);
        } catch {
          // folder may have been created concurrently
        }
      }
    }
  }
}
