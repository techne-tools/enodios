import {
  Notice,
  stringifyYaml,
  TFile
} from 'obsidian';

import type { Plugin } from './Plugin.ts';

/**
 * Parsed representation of an Obsidian Bases (.base) YAML file.
 */
export interface BaseView {
  type: 'cards' | 'list' | 'map' | 'table';
  name?: string;
  limit?: number;
  order?: string[];
  filters?: unknown;
  groupBy?: { property: string; direction?: 'ASC' | 'DESC' };
  summaries?: Record<string, string>;
}

export interface BaseFile {
  /** Global filters applied to all views */
  filters?: unknown;
  /** Formula definitions */
  formulas?: Record<string, string>;
  /** Property display configurations */
  properties?: Record<string, { displayName?: string }>;
  /** Custom summary formulas */
  summaries?: Record<string, string>;
  /** View definitions */
  views?: BaseView[];
}

/**
 * Manages Obsidian Bases (.base) files in the vault.
 *
 * ARCHITECTURAL ROLE:
 * BasesManager gives the Hermes agent awareness of database-style views defined
 * over the vault. It can list, read, summarise, and generate .base YAML so the
 * agent can create structured views from a user's note properties.
 *
 * DESIGN DECISIONS:
 * - Parsing uses a lightweight YAML-like extraction rather than a full YAML parser
 *   to avoid adding a dependency. The obsidian.d.ts API provides `parseYaml()` which
 *   we use directly via the global `obsidian` module.
 * - `generateBase()` is a pure function for testability.
 * - The guard `file.extension === 'base'` is checked at call sites to avoid mis-parses.
 */
export class BasesManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Returns all `.base` files in the vault.
   */
  public listBases(): TFile[] {
    return this.plugin.app.vault
      .getFiles()
      .filter((f) => f.extension === 'base');
  }

  /**
   * Reads and parses a `.base` YAML file.
   * Returns null on read/parse error.
   */
  public async parseBase(file: TFile): Promise<BaseFile | null> {
    if (file.extension !== 'base') {
      return null;
    }
    try {
      const raw = await this.plugin.app.vault.read(file);
      // Use Obsidian's built-in YAML parser (available globally in plugin context)
      const { parseYaml } = await import('obsidian');
      return parseYaml(raw) as BaseFile;
    } catch (err) {
      this.plugin.debug.error(`Failed to parse base file: ${file.path}`, err);
      return null;
    }
  }

  /**
   * Formats a parsed BaseFile as a markdown context summary for the agent.
   */
  public formatBaseForContext(base: BaseFile, file: TFile): string {
    const lines: string[] = [`--- Base: ${file.basename} ---`];

    if (base.formulas && Object.keys(base.formulas).length > 0) {
      lines.push(`Formulas: ${Object.keys(base.formulas).join(', ')}`);
    }

    if (base.views && base.views.length > 0) {
      lines.push(`Views (${String(base.views.length)}):`);
      for (const view of base.views) {
        const name = view.name ?? '(unnamed)';
        const cols = view.order ? ` — columns: ${view.order.join(', ')}` : '';
        const limit = view.limit !== undefined ? ` — limit: ${String(view.limit)}` : '';
        lines.push(`  [${view.type}] ${name}${cols}${limit}`);
      }
    } else {
      lines.push('Views: none defined');
    }

    if (base.filters) {
      lines.push(`Global filters: ${JSON.stringify(base.filters)}`);
    }

    lines.push(
      '',
      'To create or modify a .base file, write valid YAML with `views`, `filters`, `formulas`, and `properties` keys.',
      '------------------------------'
    );

    return lines.join('\n');
  }

  /**
   * Generates a valid `.base` YAML string from a configuration object.
   * Pure function — does not write to the vault.
   */
  public generateBase(config: Omit<BaseFile, never>): string {
    return stringifyYaml(config);
  }

  /**
   * Creates a new .base file at the given path, or overwrites if it already exists.
   */
  public async saveBase(path: string, config: BaseFile): Promise<TFile | null> {
    const content = this.generateBase(config);
    try {
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.plugin.app.vault.modify(existing, content);
        return existing;
      }
      return await this.plugin.app.vault.create(path, content);
    } catch (err) {
      new Notice(`Failed to save base file: ${path}`);
      this.plugin.debug.error(`Failed to save base: ${path}`, err);
      return null;
    }
  }

  /**
   * Creates a new .base file with default configuration and opens it.
   */
  public async createBase(name: string): Promise<string> {
    const safeName = name.trim().replace(/\.base$/, '') || 'new-base';
    const path = `${safeName}.base`;

    const config: BaseFile = {
      views: [
        {
          limit: 50,
          name: 'All Notes',
          type: 'table'
        }
      ]
    };

    const file = await this.saveBase(path, config);
    if (!file) {
      return `Failed to create Bases file: \`${path}\``;
    }

    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    return `Created and opened Bases file: \`${path}\``;
  }
}
