import type { App } from 'obsidian';

/**
 * Checks if a specific plugin (core or community) is enabled in Obsidian.
 * 
 * @param app The Obsidian App instance
 * @param pluginId The ID of the plugin (e.g. 'note-composer', 'templates', 'slides', 'bases')
 */
export function isPluginEnabled(app: App, pluginId: string): boolean {
  // Check core plugins
  const internalPlugins = (app as unknown as {
    internalPlugins?: {
      plugins?: Record<string, { enabled?: boolean }>;
    }
  }).internalPlugins;
  
  if (internalPlugins?.plugins?.[pluginId]?.enabled) {
    return true;
  }
  
  // Check community plugins
  const customPlugins = (app as unknown as {
    plugins?: {
      plugins?: Record<string, unknown>;
    }
  }).plugins;
  
  if (customPlugins?.plugins?.[pluginId]) {
    return true;
  }
  
  return false;
}
