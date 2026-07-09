import { TFile } from 'obsidian';
import type { Plugin } from '../Plugin.ts';

/**
 * Generates an enhanced note context string including word count, tags, YAML frontmatter,
 * document outline, and backlinks. For `.canvas` files, produces a structured summary.
 * For `.base` files, produces a YAML view summary.
 */
export async function getEnhancedNoteContext(plugin: Plugin, file: TFile): Promise<string> {
  // Delegate .canvas files to CanvasManager
  if (file.extension === 'canvas') {
    const canvas = await plugin.canvasManager.parseCanvas(file);
    if (canvas) {
      return plugin.canvasManager.formatCanvasForContext(canvas, file);
    }
    return `[Unable to parse canvas: ${file.path}]`;
  }

  // Delegate .base files to BasesManager
  if (file.extension === 'base') {
    const base = await plugin.basesManager.parseBase(file);
    if (base) {
      return plugin.basesManager.formatBaseForContext(base, file);
    }
    return `[Unable to parse base: ${file.path}]`;
  }

  try {
    const content = await plugin.app.vault.read(file);
    const cache = plugin.app.metadataCache.getFileCache(file);

    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const charCount = content.length;
    const ctime = file.stat.ctime ? new Date(file.stat.ctime) : new Date();
    const mtime = file.stat.mtime ? new Date(file.stat.mtime) : new Date();
    const created = isNaN(ctime.getTime()) ? new Date().toISOString() : ctime.toISOString();
    const modified = isNaN(mtime.getTime()) ? new Date().toISOString() : mtime.toISOString();

    // Extract tags from cache (both inline tags and frontmatter tags)
    const tagsSet = new Set<string>();
    if (cache?.tags) {
      cache.tags.forEach((t) => tagsSet.add(t.tag));
    }
    if (cache?.frontmatter && cache.frontmatter['tags']) {
      const rawTags = cache.frontmatter['tags'];
      if (Array.isArray(rawTags)) {
        rawTags.forEach((t) => tagsSet.add(String(t)));
      } else if (typeof rawTags === 'string') {
        rawTags.split(/,\s*/).forEach((t) => tagsSet.add(t));
      }
    }
    const tags = tagsSet.size > 0 ? Array.from(tagsSet).join(', ') : 'None';

    const frontmatterStr = cache?.frontmatter
      ? JSON.stringify(cache.frontmatter, null, 2)
      : 'None';

    // Outline (headings tree + backlinks)
    const outlineBlock = plugin.outlineManager.formatOutlineForContext(file);
    const backlinks = plugin.outlineManager.getBacklinks(file);
    const backlinksStr =
      backlinks.length > 0
        ? backlinks.map((b) => `[[${b.sourcePath}]] (${b.linkCount})`).join(', ')
        : 'None';

    const metadataBlock = [
      '--- Note Metadata ---',
      `Path: ${file.path}`,
      `Title: ${file.basename}`,
      `Created: ${created}`,
      `Modified: ${modified}`,
      `Word Count: ${wordCount}`,
      `Character Count: ${charCount}`,
      `Tags: ${tags}`,
      `Backlinks: ${backlinksStr}`,
      `Frontmatter: ${frontmatterStr}`,
      '---------------------',
      ''
    ].join('\n');

    return metadataBlock + outlineBlock + content;
  } catch (err) {
    plugin.debug.error(`Failed to generate enhanced context for ${file.path}`, err);
    return `[Error loading note content for ${file.path}]`;
  }
}

/**
 * Summarizes the contents of a folder, listing all files, and embeds the content of the first 5 notes.
 */
export async function getFolderContext(plugin: Plugin, folderPath: string): Promise<string> {
  const vault = plugin.app.vault;
  const folder = vault.getAbstractFileByPath(folderPath);

  if (!folder) {
    return `Folder not found: ${folderPath}`;
  }

  // Get all files recursively under this folder
  const allFiles = vault.getFiles().filter((file) =>
    file.path === folderPath || file.path.startsWith(folderPath + '/')
  );

  if (allFiles.length === 0) {
    return `Folder **${folderPath}** is empty.`;
  }

  let summary = `### 📂 Folder Context: ${folderPath}\n`;
  summary += `Total Files: ${allFiles.length}\n\n`;
  summary += '| File Path | Size (Bytes) | Last Modified | Tags |\n';
  summary += '| :--- | :--- | :--- | :--- |\n';

  const notes: TFile[] = [];

  for (const file of allFiles) {
    const cache = plugin.app.metadataCache.getFileCache(file);
    const tagsSet = new Set<string>();
    if (cache?.tags) {
      cache.tags.forEach((t) => tagsSet.add(t.tag));
    }
    const tags = tagsSet.size > 0 ? Array.from(tagsSet).join(', ') : '';
    const mtimeStr = new Date(file.stat.mtime).toISOString().substring(0, 16).replace('T', ' ');

    summary += `| ${file.path} | ${file.stat.size} | ${mtimeStr} | ${tags} |\n`;

    if (file.extension === 'md') {
      notes.push(file);
    }
  }

  summary += '\n';

  // Embed the content of the first 5 notes
  const embedNotes = notes.slice(0, 5);
  if (embedNotes.length > 0) {
    summary += `#### Contents of Top ${embedNotes.length} Notes in Folder:\n`;
    for (const note of embedNotes) {
      const noteContent = await getEnhancedNoteContext(plugin, note);
      summary += `\n\n---\n**Content of ${note.path}**:\n${noteContent}\n---\n`;
    }
  }

  return summary;
}
