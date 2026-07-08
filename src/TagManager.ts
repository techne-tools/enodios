import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

/**
 * Manages tag loading, keyword-matching tag suggestions, and auto-tagging notes.
 */
export class TagManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Retrieves all tags in the vault with their occurrence count.
   */
  public getAllVaultTagsWithCounts(): Record<string, number> {
    const tagsCount: Record<string, number> = {};
    const files = this.plugin.app.vault.getMarkdownFiles();

    for (const file of files) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache) continue;

      // Scan inline tags
      if (cache.tags) {
        for (const t of cache.tags) {
          const tagName = t.tag.startsWith('#') ? t.tag : `#${t.tag}`;
          tagsCount[tagName] = (tagsCount[tagName] || 0) + 1;
        }
      }

      // Scan frontmatter tags
      if (cache.frontmatter) {
        const rawTags = cache.frontmatter['tags'] || cache.frontmatter['tag'];
        if (rawTags) {
          if (Array.isArray(rawTags)) {
            for (const t of rawTags) {
              const clean = String(t).trim();
              if (clean) {
                const tagName = clean.startsWith('#') ? clean : `#${clean}`;
                tagsCount[tagName] = (tagsCount[tagName] || 0) + 1;
              }
            }
          } else if (typeof rawTags === 'string') {
            const parts = rawTags.split(/,\s*/);
            for (const p of parts) {
              const clean = p.trim();
              if (clean) {
                const tagName = clean.startsWith('#') ? clean : `#${clean}`;
                tagsCount[tagName] = (tagsCount[tagName] || 0) + 1;
              }
            }
          }
        }
      }
    }

    return tagsCount;
  }

  /**
   * Analyzes content and title to suggest existing vault tags with confidence scores.
   */
  public suggestTagsForContent(content: string, title: string): { tag: string; confidence: number }[] {
    const vaultTags = this.getAllVaultTagsWithCounts();
    const suggestions: { tag: string; confidence: number }[] = [];

    const contentLower = content.toLowerCase();
    const titleLower = title.toLowerCase();

    // Split title and content into alphanumeric words for quick lookup
    const titleWords = new Set(titleLower.split(/[^a-zA-Z0-9_]+/));
    const contentWords = new Set(contentLower.split(/[^a-zA-Z0-9_]+/));

    // Get first paragraph or first 300 chars of note body
    const bodySnippet = contentLower.slice(0, 300);
    const snippetWords = new Set(bodySnippet.split(/[^a-zA-Z0-9_]+/));

    for (const [tag] of Object.entries(vaultTags)) {
      // Remove leading '#'
      const cleanTag = tag.slice(1).toLowerCase();
      if (!cleanTag) continue;

      // Handle hierarchical tags (e.g., 'academic/writing')
      const tagParts = cleanTag.split('/');

      let maxScore = 0;

      // 1. Exact match in title
      if (titleLower.includes(cleanTag) || tagParts.every((part) => titleWords.has(part))) {
        maxScore = Math.max(maxScore, 0.85);
      }

      // 2. Exact match in first paragraph / snippet
      if (bodySnippet.includes(cleanTag) || tagParts.every((part) => snippetWords.has(part))) {
        maxScore = Math.max(maxScore, 0.65);
      }

      // 3. Match frequency in body
      if (contentLower.includes(cleanTag)) {
        // Count occurrences of cleanTag in content
        const occurrences = contentLower.split(cleanTag).length - 1;
        const freqScore = Math.min(0.5, 0.3 + 0.05 * occurrences);
        maxScore = Math.max(maxScore, freqScore);
      } else {
        // Check if all parts of a hierarchical tag appear in the content words
        const allPartsMatch = tagParts.every((part) => contentWords.has(part));
        if (allPartsMatch) {
          maxScore = Math.max(maxScore, 0.4);
        }
      }

      if (maxScore > 0) {
        suggestions.push({ tag, confidence: Number(maxScore.toFixed(2)) });
      }
    }

    // Sort by confidence descending, then by tag name ascending
    return suggestions
      .sort((a, b) => b.confidence - a.confidence || a.tag.localeCompare(b.tag))
      .slice(0, 10);
  }

  /**
   * Applies selected tags to a note's frontmatter.
   */
  public async applyTagsToNote(file: TFile, tags: string[]): Promise<void> {
    if (tags.length === 0) return;

    await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      // Get existing tags from frontmatter
      const rawExisting = frontmatter['tags'] || frontmatter['tag'] || [];
      const cleanTags = new Set<string>();

      // Helper to clean and add tag (no leading # in frontmatter)
      const addCleanTag = (t: unknown) => {
        const clean = String(t).replace(/^#/, '').trim();
        if (clean) cleanTags.add(clean);
      };

      // Process existing tags
      if (Array.isArray(rawExisting)) {
        rawExisting.forEach(addCleanTag);
      } else if (typeof rawExisting === 'string') {
        rawExisting.split(/,\s*/).forEach(addCleanTag);
      }

      // Process new tags to apply
      tags.forEach(addCleanTag);

      // Save back to frontmatter
      delete frontmatter['tag'];
      frontmatter['tags'] = Array.from(cleanTags);
    });
  }
}
