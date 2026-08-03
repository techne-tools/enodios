import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface ChatTemplate {
  id: string;
  name: string;
  prompt: string;
  icon: string;
  description: string;
}

/**
 * Manages loading custom and built-in conversation templates, and saving prompts to the vault.
 */
export class TemplateManager {
  private readonly plugin: Plugin;

  // Built-in templates
  private readonly BUILT_IN_TEMPLATES: ChatTemplate[] = [
    {
      id: 'lit-review',
      name: 'Literature Review',
      prompt:
        'Act as an academic researcher. Analyze the attached note(s)/paper(s), summarize their key methodology, primary claims, and any theoretical frameworks used. Contrast this with other known works and highlight gaps or future work directions.',
      icon: '📚',
      description: 'Summarize papers and extract methodologies.'
    },
    {
      id: 'writing-coach',
      name: 'Writing Coach',
      prompt:
        'Act as a professional editor and writing coach. Review the attached text for flow, grammar, structural coherence, and tone. Provide constructive criticism and suggest 3 concrete improvements.',
      icon: '✍️',
      description: 'Improve flow, structure, and grammar.'
    },
    {
      id: 'code-assistant',
      name: 'Code Assistant',
      prompt:
        'Act as an expert software engineer. Explain the attached code block or file, document it with clear comments, and refactor it for performance, readability, and best practices. Explain the changes you make.',
      icon: '💻',
      description: 'Explain, document, or refactor code.'
    },
    {
      id: 'study-companion',
      name: 'Study Companion',
      prompt:
        'Act as an educational tutor. Based on the attached study notes, generate 5 challenging flashcard-style Q&A pairs and 1 conceptual summary paragraph to help me review the core ideas.',
      icon: '🧠',
      description: 'Create flashcards and conceptual summaries.'
    }
  ];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Loads all templates, combining built-ins with custom templates stored in vault at hermes/templates/.
   */
  public async loadTemplates(): Promise<ChatTemplate[]> {
    const templates = [...this.BUILT_IN_TEMPLATES];
    const templatesFolder = 'hermes/templates';

    // Check if templates folder exists in vault
    const folder = this.plugin.app.vault.getAbstractFileByPath(templatesFolder);
    if (!folder) {
      return templates;
    }

    const files = this.plugin.app.vault.getFiles();
    for (const file of files) {
      if (file.path.startsWith(`${templatesFolder}/`) && file.extension === 'md') {
        try {
          const content = await this.plugin.app.vault.read(file);
          const cache = this.plugin.app.metadataCache.getFileCache(file);

          let name = file.basename;
          let icon = '📄';
          let description = 'Custom saved template';
          let prompt = content;

          if (cache?.frontmatter) {
            if (cache.frontmatter['name']) name = String(cache.frontmatter['name']);
            if (cache.frontmatter['icon']) icon = String(cache.frontmatter['icon']);
            if (cache.frontmatter['description']) description = String(cache.frontmatter['description']);
          }

          // Strip YAML frontmatter from the prompt body
          if (content.startsWith('---')) {
            const parts = content.split('---');
            if (parts.length > 2) {
              prompt = parts.slice(2).join('---').trim();
            }
          }

          if (prompt.trim()) {
            templates.push({
              id: `custom-${file.basename.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
              name,
              prompt: prompt.trim(),
              icon,
              description
            });
          }
        } catch (err) {
          this.plugin.debug.error(`Failed to load template file ${file.path}`, err);
        }
      }
    }

    return templates;
  }

  /**
   * Saves a custom template in the vault.
   */
  public async saveTemplate(name: string, prompt: string, icon = '📄', description = 'Custom saved template'): Promise<void> {
    const templatesFolder = 'hermes/templates';

    // Ensure the folder exists
    const folderExists = this.plugin.app.vault.getAbstractFileByPath(templatesFolder);
    if (!folderExists) {
      await this.plugin.app.vault.createFolder(templatesFolder);
    }

    const filename = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const filepath = `${templatesFolder}/${filename}.md`;

    const fileContent = `---
name: ${name}
icon: ${icon}
description: ${description}
---
${prompt}
`;

    const existingFile = this.plugin.app.vault.getAbstractFileByPath(filepath);
    if (existingFile instanceof TFile) {
      await this.plugin.app.vault.modify(existingFile, fileContent);
    } else {
      await this.plugin.app.vault.create(filepath, fileContent);
    }
  }
}
