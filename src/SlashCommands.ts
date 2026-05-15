import { HermesAPI } from './HermesAPI.ts';
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
  }
];

let customCommands: SlashCommand[] = [];
let cachedToolCommands: SlashCommand[] = [];
let lastToolFetch = 0;
const TOOL_CACHE_TTL_MS = 60_000;

/**
 * Fetch available tools from the Hermes API and convert them to slash commands.
 * Results are cached for 60 seconds.
 */
export async function getToolSlashCommands(plugin: Plugin): Promise<SlashCommand[]> {
  const now = Date.now();
  if (now - lastToolFetch < TOOL_CACHE_TTL_MS && cachedToolCommands.length > 0) {
    return cachedToolCommands;
  }

  const api = new HermesAPI(plugin);
  const tools = await api.getTools();

  if (!tools || tools.length === 0) {
    cachedToolCommands = [];
    return [];
  }

  cachedToolCommands = tools.map((tool) => ({
    description: tool.description || `Call ${tool.name} tool`,
    execute: async (p: Plugin, args: string) => {
      const hermesApi = new HermesAPI(p);
      const response = await hermesApi.sendMessageWithResponseAPI(
        `/${tool.name} ${args}`,
        undefined,
        'obsidian-chat'
      );

      if (response?.output) {
        const output = response.output.find((out) => out.type === 'message' && out.role === 'assistant');
        if (output?.content) {
          const text = typeof output.content === 'string'
            ? output.content
            : output.content.map((c) => c.text ?? '').join('\n');
          return text || `Tool ${tool.name} executed.`;
        }
      }
      return `Tool ${tool.name} executed with no output.`;
    },
    name: tool.name
  }));

  lastToolFetch = now;
  return cachedToolCommands;
}

/**
 * Clear the cached tool commands (e.g. after settings change).
 */
export function clearToolCache(): void {
  cachedToolCommands = [];
  lastToolFetch = 0;
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
 */
export function getSlashCommands(): SlashCommand[] {
  return [...BUILT_IN_COMMANDS, ...customCommands, ...cachedToolCommands];
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
