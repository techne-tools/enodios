import { Notice, TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Integrates with the Obsidian Templates core plugin to list, read, and insert
 * note templates stored in the user's configured templates folder.
 *
 * ARCHITECTURAL ROLE:
 * NoteTemplateManager bridges the gap between Obsidian's Templates core plugin
 * and the Hermes agent. It surfaces the user's note templates so the agent can
 * reference their structure or insert them into the active note.
 *
 * NAMING CLARIFICATION:
 * This class is distinct from `TemplateManager` which manages Hermes *conversation*
 * templates (stored in `hermes/templates/`). NoteTemplateManager manages Obsidian's
 * built-in *note* templates configured via Settings → Templates.
 *
 * DESIGN DECISIONS:
 * - `getTemplatesFolder()` reads the Templates plugin config via `app.internalPlugins`.
 *   If the plugin is disabled or unconfigured, the user can set `noteTemplatesFolder`
 *   in Hermes settings as an override.
 * - `insertTemplate()` appends at the end of the target note rather than at the
 *   cursor position (cursor position is not accessible from a manager class without
 *   an editor reference; editor-aware insertion is handled in the slash command).
 */
export class NoteTemplateManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Returns the configured templates folder path.
   * Priority: Hermes setting override → Obsidian Templates plugin config → null.
   */
  public getTemplatesFolder(): null | string {
    // User-defined override in Hermes settings
    const override = this.plugin.settings.noteTemplatesFolder?.trim();
    if (override) {
      return override;
    }

    // Read from Obsidian's internal Templates plugin config
    try {
      const internalPlugins = (this.plugin.app as unknown as {
        internalPlugins?: {
          plugins?: {
            templates?: {
              enabled?: boolean;
              instance?: { options?: { folder?: string } };
            };
          };
        };
      }).internalPlugins;

      const templatesPlugin = internalPlugins?.plugins?.templates;
      if (templatesPlugin?.enabled && templatesPlugin.instance?.options?.folder) {
        return templatesPlugin.instance.options.folder;
      }
    } catch {
      // Internal API access failure — fall through
    }

    return null;
  }

  /**
   * Returns all `.md` files in the configured templates folder.
   * Returns an empty array if no templates folder is configured or accessible.
   */
  public listNoteTemplates(): TFile[] {
    const folder = this.getTemplatesFolder();
    if (!folder) {
      return [];
    }

    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${folder}/`) || f.path === folder);
  }

  /**
   * Finds a template by (case-insensitive) basename match.
   */
  public findTemplate(name: string): TFile | null {
    const normalizedName = name.trim().toLowerCase();
    return (
      this.listNoteTemplates().find(
        (f) => f.basename.toLowerCase() === normalizedName
      ) ?? null
    );
  }

  /**
   * Reads and returns the raw content of a template file.
   */
  public async readTemplate(template: TFile): Promise<string> {
    return this.plugin.app.vault.read(template);
  }

  /**
   * Inserts the template content at the end of the target note.
   * For cursor-position insertion, the caller should use the editor directly.
   */
  public async insertTemplate(template: TFile, target: TFile): Promise<void> {
    const [templateContent, targetContent] = await Promise.all([
      this.plugin.app.vault.read(template),
      this.plugin.app.vault.read(target)
    ]);

    const separator = targetContent.endsWith('\n') ? '\n' : '\n\n';
    await this.plugin.app.vault.modify(
      target,
      targetContent + separator + templateContent.trim() + '\n'
    );

    new Notice(`Template "${template.basename}" inserted into ${target.basename}.`);
  }

  /**
   * Formats the list of available templates as a markdown context block.
   */
  public formatTemplatesListForContext(templates: TFile[]): string {
    if (templates.length === 0) {
      return 'No note templates found. Configure the Templates folder in Settings → Core plugins → Templates.';
    }

    const lines = [`--- Obsidian Note Templates (${templates.length}) ---`];
    for (const t of templates) {
      lines.push(`  • ${t.basename} (${t.path})`);
    }
    lines.push('', 'Use `/note-template insert <name>` to insert into the active note.');
    lines.push('------------------------------');
    return lines.join('\n');
  }
}
