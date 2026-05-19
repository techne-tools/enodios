import { TFile } from 'obsidian';
import type { Plugin } from './Plugin.ts';

export interface SlashCommand {
  description: string;
  execute: (plugin: Plugin, args: string) => Promise<string | null>;
  name: string;
}

/**
 * Registry of built-in slash commands.
 * Commands are invoked with `/name [args]` in the chat input.
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
    description: 'Add the current note or selection to context',
    execute: async (plugin) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        return 'No active file to add to context.';
      }
      return `Added **${activeFile.basename}** to context.`;
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
      if (!activeFile || activeFile.extension !== 'canvas') {
        return 'No active Canvas file found. Please open a .canvas file first.';
      }
      try {
        const content = await plugin.app.vault.read(activeFile);
        const canvasData = JSON.parse(content);

        let summary = `Attached current Canvas mind-map (**${activeFile.basename}.canvas**).\n\n`;
        summary += 'Raw JSON structure:\n```json\n' + JSON.stringify(canvasData, null, 2) + '\n```\n\n';
        summary += `**Instructions for Hermes:**\nTo create or modify a Canvas, use the \`writeTextFile\` tool to write valid JSON to a \`.canvas\` file path. Ensure you include a \`nodes\` array (id, type: "text"|"file"|"group", x, y, width, height) and an \`edges\` array (id, fromNode, fromSide, toNode, toSide).`;

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
        p.id.toLowerCase() === query ||
        p.name.toLowerCase().includes(query)
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
      const matches: Array<{ file: TFile; score: number; excerpt: string }> = [];

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
          if (start > 0) excerpt = '...' + excerpt;
          if (end < content.length) excerpt = excerpt + '...';

          matches.push({ file, score, excerpt });
        }
      }

      if (matches.length === 0) {
        return `No vault notes found matching "${args}".`;
      }

      matches.sort((a, b) => b.score - a.score);
      const topMatches = matches.slice(0, 5);

      let result = `### 🔍 Vault Search Results for "${args}"\n\n`;
      result += `*System note: The following excerpts were retrieved from the user's vault. Use them to answer the prompt. To read a full file, use the \`readTextFile\` tool on its path.*\n\n`;

      for (const match of topMatches) {
        result += `**Path:** \`${match.file.path}\`\n> ${match.excerpt}\n\n`;
      }

      return result;
    },
    name: 'search'
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
 * Set the cached tool commands from ACP available_commands_update.
 */
export function setCachedToolCommands(commands: SlashCommand[]): void {
  cachedToolCommands = commands;
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
 * Clear the cached tool commands (e.g. after settings change).
 */
export function clearToolCache(): void {
  cachedToolCommands = [];
}

/**
 * Register a custom slash command at runtime.
 */
export function registerSlashCommand(command: SlashCommand): void {
  customCommands.push(command);
}

/**
 * Unregister a custom slash command by name.
 */
export function unregisterSlashCommand(name: string): void {
  customCommands = customCommands.filter((cmd) => cmd.name !== name);
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
 * Parse a message to detect if it starts with a slash command.
 * Checks built-in, custom, and cached tool commands.
 * Returns the command and remaining args, or null if not a slash command.
 */
export function parseSlashCommand(message: string): { args: string; command: SlashCommand } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.slice(1).split(/\s+(.*)/);
  const name = parts[0] ?? '';
  const args = parts[1] ?? '';

  const allCommands = [...BUILT_IN_COMMANDS, ...customCommands, ...cachedToolCommands];
  const command = allCommands.find((cmd) => cmd.name === name);
  if (!command) return null;

  return { args, command };
}
