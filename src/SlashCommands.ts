import { TFile } from 'obsidian';

import type { Plugin } from './Plugin.ts';

export interface SlashCommand {
  description: string;
  execute: (plugin: Plugin, args: string) => Promise<null | string>;
  name: string;
}

/**
 * Registry of built-in slash commands.
 * Commands are invoked with `/name [args]` in the chat input.
 *
 * ARCHITECTURAL ROLE:
 * Slash commands provide a lightweight, discoverable way for users to
 * trigger plugin actions without leaving the chat context. They are
 * parsed by the chat view (`HermesChatView`) and executed client-side.
 *
 * DESIGN DECISIONS:
 * - Commands return strings (displayed as assistant messages) or null
 *   (for silent operations like `/clear`).
 * - The `execute` function receives the full Plugin instance so commands
 *   can access vault, settings, and API clients directly.
 * - Commands are NOT sent to the Hermes agent — they are purely local UI
 *   shortcuts. This keeps latency low and avoids consuming API tokens.
 *
 * ADDING A NEW COMMAND:
 * 1. Add an entry to `BUILT_IN_COMMANDS`
 * 2. Implement `execute` — return a user-facing string or null
 * 3. The chat view will auto-register `/help` to list all commands
 */
const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    description: 'Clear the current conversation',
    execute: async (_plugin) => {
      return null;
    },
    name: 'clear'
  },
  {
    description: 'Display a summary of the currently attached context items.',
    execute: async (plugin) => {
      const leaves = plugin.app.workspace.getLeavesOfType('hermes-chat-view');
      if (leaves.length === 0) {
        return 'No active chat view found.';
      }
      const view = leaves[0]!.view as any;
      const items: any[] = view.activeContextItems || [];
      if (items.length === 0) {
        return 'Context is currently empty. Use the `@` button or type `[[` to add notes.';
      }

      let list = '### 📎 Active Chat Context\n\n';
      for (const item of items) {
        let details = '';
        if (item.type === 'note') {
          const path = item.id.replace(/^note-/, '');
          const file = plugin.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            const content = await plugin.app.vault.read(file);
            const words = content.split(/\s+/).filter(Boolean).length;
            details = ` (${words} words, ${content.length} chars)`;
          }
        } else if (item.type === 'selection') {
          details = ` (selection: ${item.text.length} chars)`;
        } else if (item.type === 'folder') {
          const path = item.id.replace(/^folder-/, '');
          const files = plugin.app.vault.getFiles().filter((f) => f.path.startsWith(path + '/'));
          details = ` (folder: ${files.length} files)`;
        } else if (item.type === 'pdf') {
          details = ' (PDF attachment)';
        } else if (item.type === 'image') {
          details = ' (image)';
        }

        list += `* **[${item.type.toUpperCase()}]** ${item.text}${details}\n`;
      }
      return list;
    },
    name: 'context'
  },
  {
    description: 'Show available slash commands',
    execute: async (_plugin) => {
      const commands = getSlashCommands();
      const list = commands
        .map((cmd) => `**/${cmd.name}** — ${cmd.description}`)
        .join('\n');
      return `Available commands:\n\n${list}`;
    },
    name: 'help'
  },
  {
    description: 'Read the active Canvas mind-map to context',
    execute: async (plugin) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (activeFile?.extension !== 'canvas') {
        return 'No active Canvas file found. Please open a .canvas file first.';
      }
      try {
        const content = await plugin.app.vault.read(activeFile);
        const canvasData = JSON.parse(content);

        let summary = `Attached current Canvas mind-map (**${activeFile.basename}.canvas**).\n\n`;
        summary += `Raw JSON structure:\n\`\`\`json\n${JSON.stringify(canvasData, null, 2)}\n\`\`\`\n\n`;
        summary += '**Instructions for Hermes:**\nTo create or modify a Canvas, use the `write_file` tool to write valid JSON to a `.canvas` file path. Ensure you include a `nodes` array (id, type: "text"|"file"|"group", x, y, width, height) and an `edges` array (id, fromNode, fromSide, toNode, toSide).';

        return summary;
      } catch (err) {
        return `Failed to read Canvas data: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    name: 'canvas'
  },
  {
    description: 'Switch persona / system prompt template',
    execute: async (plugin, args) => {
      const personas = plugin.settings.personaTemplates;
      const query = args.trim().toLowerCase();

      if (!query) {
        const list = personas
          .map((p) => `**${p.name}** (${p.id})${plugin.settings.activePersonaId === p.id ? ' ← active' : ''}`)
          .join('\n');
        return `Available personas:\n\n${list}\n\nUse \`/persona \u003cid\u003e\` to switch.`;
      }

      const match = personas.find((p) =>
        p.id.toLowerCase() === query
        || p.name.toLowerCase().includes(query)
      );

      if (!match) {
        return `Persona "${args}" not found. Use \`/persona\` to list available personas.`;
      }

      // @ts-expect-error - settings are mutable at runtime for persona switching
      plugin.settings.activePersonaId = match.id;
      await plugin.settingsManager.saveToFile();

      return `Switched to **${match.name}**. ${match.systemPrompt ? 'System prompt updated.' : 'No system prompt set for this persona.'}`;
    },
    name: 'persona'
  },
  {
    description: 'Search the vault and append results to context (Local RAG)',
    execute: async (plugin, args) => {
      if (!args.trim()) {
        return 'Please provide a search query. Example: `/search project goals`';
      }

      const query = args.toLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      const files = plugin.app.vault.getMarkdownFiles();
      const matches: { excerpt: string; file: TFile; score: number }[] = [];

      for (const file of files) {
        const content = await plugin.app.vault.cachedRead(file);
        const lowerContent = content.toLowerCase();

        let score = 0;
        let firstMatchIdx = -1;

        for (const term of terms) {
          const idx = lowerContent.indexOf(term);
          if (idx !== -1) {
            score += 1;
            if (firstMatchIdx === -1 || idx < firstMatchIdx) {
              firstMatchIdx = idx;
            }
          }
        }

        if (score > 0) {
          const start = Math.max(0, firstMatchIdx - 60);
          const end = Math.min(content.length, firstMatchIdx + 200);
          let excerpt = content.slice(start, end).replace(/\n/g, ' ');
          if (start > 0) { excerpt = `...${excerpt}`; }
          if (end < content.length) { excerpt += '...'; }

          matches.push({ excerpt, file, score });
        }
      }

      if (matches.length === 0) {
        return `No vault notes found matching "${args}".`;
      }

      matches.sort((a, b) => b.score - a.score);
      const topMatches = matches.slice(0, 5);

      let result = `### 🔍 Vault Search Results for "${args}"\n\n`;
      result += '*System note: The following excerpts were retrieved from the user\'s vault. Use them to answer the prompt. To read a full file, use the `read_file` tool on its path.*\n\n';

      for (const match of topMatches) {
        result += `**Path:** \`${match.file.path}\`\n> ${match.excerpt}\n\n`;
      }

      return result;
    },
    name: 'search'
  },
  {
    description: 'Manage citations & styles. Usage: /cite style [apa|mla|chicago|ieee] OR /cite search [query] OR /cite bib',
    execute: async (plugin, args) => {
      if (!plugin.settings.enableCitations) {
        return 'Citations feature is disabled in settings.';
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const subArgs = parts.slice(1).join(' ');

      if (sub === 'style') {
        const style = subArgs.toLowerCase().trim() as 'apa' | 'mla' | 'chicago' | 'ieee';
        if (!['apa', 'chicago', 'ieee', 'mla'].includes(style)) {
          return `Invalid style. Available: **apa**, **mla**, **chicago**, **ieee**`;
        }
        // @ts-expect-error - mutable setting
        plugin.settings.citationStyle = style;
        await plugin.settingsManager.saveToFile();
        return `Citation style updated to **${style.toUpperCase()}**.`;
      }

      if (sub === 'search') {
        const query = subArgs;
        await plugin.citationManager.loadBibliography();
        const results = plugin.citationManager.search(query);
        if (results.length === 0) {
          return `No citations found for query "${query}".`;
        }
        let list = `### 🔍 Citation Search Results for "${query}"\n\n`;
        results.forEach((item) => {
          list += `* **[@${item.key}]** — *${item.title}* by ${item.author} (${item.year})\n`;
        });
        return list;
      }

      if (sub === 'bib') {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile) {
          return 'No active file to generate bibliography for.';
        }
        const content = await plugin.app.vault.read(activeFile);
        const style = plugin.settings.citationStyle;
        const bib = plugin.citationManager.generateBibliographyForContent(content, style);
        if (!bib) {
          return 'No citations found in this file to generate references for. Ensure citations use `[@citation-key]` format.';
        }

        let newContent = content;
        const refHeaders = [
          /\n\n## References[\s\S]*$/i,
          /\n\n# References[\s\S]*$/i,
          /\n\n## Bibliography[\s\S]*$/i,
          /\n\n# Bibliography[\s\S]*$/i
        ];

        let replaced = false;
        for (const regex of refHeaders) {
          if (regex.test(content)) {
            newContent = content.replace(regex, bib);
            replaced = true;
            break;
          }
        }

        if (!replaced) {
          newContent = content + bib;
        }

        await plugin.app.vault.modify(activeFile, newContent);
        return `Generated bibliography and appended to **${activeFile.basename}**.`;
      }

      return 'Usage:\n* `/cite style [apa|mla|chicago|ieee]`\n* `/cite search [query]`\n* `/cite bib`';
    },
    name: 'cite'
  },
  {
    description: 'Extract highlights/comments from a PDF file. Usage: /annotations <file-path>',
    execute: async (plugin, args) => {
      if (!plugin.settings.enableAnnotations) {
        return 'PDF integrations are disabled in settings.';
      }
      const path = args.trim();
      if (!path) {
        return 'Please specify a PDF file path. Example: `/annotations papers/my-paper.pdf`';
      }
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== 'pdf') {
        return `File not found or is not a PDF: \`${path}\`. Ensure it is a valid path in your vault.`;
      }

      try {
        const annots = await plugin.pdfAnnotationManager.extractAnnotations(file);
        const md = plugin.pdfAnnotationManager.formatAnnotationsMarkdown(annots, file.basename);
        return md;
      } catch (err) {
        return `Failed to extract annotations: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    name: 'annotations'
  },
  {
    description: 'Suggest or apply tags. Usage: /tags suggest OR /tags apply [tag1] [tag2] ...',
    execute: async (plugin, args) => {
      if (!plugin.settings.enableTags) {
        return 'Tags suggestion feature is disabled in settings.';
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const tagsToApply = parts.slice(1);

      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        return 'No active note found.';
      }

      if (sub === 'suggest') {
        const content = await plugin.app.vault.read(activeFile);
        const title = activeFile.basename;
        const results = plugin.tagManager.suggestTagsForContent(content, title);
        if (results.length === 0) {
          return 'No matching tags from your vault were found in this note.';
        }
        let list = `### 🏷️ Tag Suggestions for **${title}**\n\n`;
        results.forEach((r) => {
          list += `* **${r.tag}** (${Math.round(r.confidence * 100)}% confidence)\n`;
        });
        return list;
      }

      if (sub === 'apply') {
        if (tagsToApply.length === 0) {
          return 'Please specify one or more tags to apply. Example: `/tags apply academic study`';
        }
        await plugin.tagManager.applyTagsToNote(activeFile, tagsToApply);
        return `Applied tags: ${tagsToApply.map((t) => `**${t}**`).join(', ')} to **${activeFile.basename}**.`;
      }

      return 'Usage:\n* `/tags suggest` — Suggest tags for the current note\n* `/tags apply <tag1> <tag2> ...` — Apply tags to the current note';
    },
    name: 'tags'
  },
  {
    description: 'List, load, or save conversation templates. Usage: /template list OR /template load [name] OR /template save [name]',
    execute: async (plugin, args) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const name = parts.slice(1).join(' ').trim();

      if (sub === 'list') {
        const list = await plugin.templateManager.loadTemplates();
        let res = `### 📚 Conversation Templates\n\n`;
        list.forEach((t) => {
          res += `* **${t.icon} ${t.name}** — ${t.description}\n`;
        });
        return res;
      }

      if (sub === 'load') {
        if (!name) {
          return 'Please specify a template name. Example: `/template load Literature Review`';
        }
        const list = await plugin.templateManager.loadTemplates();
        const found = list.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (!found) {
          return `Template "${name}" not found. Type \`/template list\` to see available templates.`;
        }

        const event = new CustomEvent('hermes-load-template', { detail: found.prompt });
        window.dispatchEvent(event);

        return `Loaded template **${found.name}** into chat input.`;
      }

      if (sub === 'save') {
        if (!name) {
          return 'Please specify a name for the template. Example: `/template save my-coach`';
        }

        const leaves = plugin.app.workspace.getLeavesOfType('hermes-chat-view');
        if (leaves.length === 0) {
          return 'No active chat view found.';
        }
        const chatView = leaves[0]!.view as any;
        const messages = chatView.activeMessages || [];
        const userMsgs = messages.filter((m: any) => m.role === 'user');
        if (userMsgs.length === 0) {
          return 'No user prompt found in this conversation to save as template.';
        }
        const lastPrompt = userMsgs[userMsgs.length - 1].content;

        await plugin.templateManager.saveTemplate(name, lastPrompt);
        return `Template **${name}** saved successfully.`;
      }

      return 'Usage:\n* `/template list` — List all templates\n* `/template load <name>` — Load a template prompt\n* `/template save <name>` — Save the last user prompt as a template';
    },
    name: 'template'
  },
  {
    description: 'Extract PDF page text or metadata. Usage: /pdf page [path] [page] OR /pdf metadata [path]',
    execute: async (plugin, args) => {
      if (!plugin.settings.enableAnnotations) {
        return 'PDF integrations are disabled in settings.';
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const path = parts[1];
      const pageStr = parts[2];

      if (!sub || !path) {
        return 'Usage:\n* `/pdf page <pdf-path> <page-number>`\n* `/pdf metadata <pdf-path>`';
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== 'pdf') {
        return `File not found or is not a PDF: \`${path}\`.`;
      }

      if (sub === 'page') {
        const pageNum = parseInt(pageStr || '', 10);
        if (isNaN(pageNum) || pageNum < 1) {
          return 'Please specify a valid page number. Example: `/pdf page papers/my-paper.pdf 2`';
        }
        try {
          const text = await plugin.pdfAnnotationManager.extractPageText(file, pageNum);
          return `### 📄 Extracted Text from ${file.basename} (Page ${pageNum})\n\n${text}`;
        } catch (err) {
          return `Failed to extract page text: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      if (sub === 'metadata') {
        try {
          const info = await plugin.pdfAnnotationManager.extractMetadata(file);
          let res = `### 📋 Metadata for ${file.basename}\n\n`;
          Object.entries(info).forEach(([k, v]) => {
            res += `* **${k}:** ${v}\n`;
          });
          return res;
        } catch (err) {
          return `Failed to extract metadata: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      return 'Usage:\n* `/pdf page <pdf-path> <page-number>`\n* `/pdf metadata <pdf-path>`';
    },
    name: 'pdf'
  }
];

let customCommands: SlashCommand[] = [];
let cachedToolCommands: SlashCommand[] = [];

/**
 * Clear all custom and cached commands. Call on plugin unload.
 */
export function clearAllCommands(): void {
  customCommands = [];
  cachedToolCommands = [];
}

/**
 * Clear the cached tool commands (e.g. after settings change).
 */
export function clearToolCache(): void {
  cachedToolCommands = [];
}

/**
 * Get all available slash commands (built-in + custom + cached tool commands).
 * Note: Tool commands from the API are fetched separately via getToolSlashCommands().
 * Built-in commands take precedence; duplicates by name are removed.
 */
export function getSlashCommands(): SlashCommand[] {
  const all = [...BUILT_IN_COMMANDS, ...customCommands, ...cachedToolCommands];
  const seen = new Set<string>();
  return all.filter((cmd) => {
    if (seen.has(cmd.name)) {
      return false;
    }
    seen.add(cmd.name);
    return true;
  });
}

/**
 * Fetch available tools from Hermes via ACP.
 * Commands now arrive via ACP push (available_commands_update), so this is a no-op.
 * Kept for API compatibility.
 */
export async function getToolSlashCommands(_plugin: Plugin): Promise<SlashCommand[]> {
  return cachedToolCommands;
}

/**
 * Parse a message to detect if it starts with a slash command.
 * Checks built-in, custom, and cached tool commands.
 * Returns the command and remaining args, or null if not a slash command.
 */
export function parseSlashCommand(message: string): { args: string; command: SlashCommand } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) { return null; }

  const parts = trimmed.slice(1).split(/\s+(.*)/);
  const name = parts[0] ?? '';
  const args = parts[1] ?? '';

  const allCommands = [...BUILT_IN_COMMANDS, ...customCommands, ...cachedToolCommands];
  const command = allCommands.find((cmd) => cmd.name === name);
  if (!command) { return null; }

  return { args, command };
}

/**
 * Register a custom slash command at runtime.
 */
export function registerSlashCommand(command: SlashCommand): void {
  customCommands.push(command);
}

/**
 * Set the cached tool commands from ACP available_commands_update.
 */
export function setCachedToolCommands(commands: SlashCommand[]): void {
  cachedToolCommands = commands;
}

/**
 * Unregister a custom slash command by name.
 */
export function unregisterSlashCommand(name: string): void {
  customCommands = customCommands.filter((cmd) => cmd.name !== name);
}
