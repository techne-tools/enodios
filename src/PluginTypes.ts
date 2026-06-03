import type { PluginTypesBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginTypesBase';

import type { Plugin } from './Plugin.ts';
import type { PluginSettings } from './PluginSettings.ts';
import type { PluginSettingsManager } from './PluginSettingsManager.ts';
import type { PluginSettingsTab } from './PluginSettingsTab.ts';

/**
 * Type-level contract between the Plugin class and obsidian-dev-utils.
 *
 * WHY THIS EXISTS:
 * obsidian-dev-utils uses a generic "PluginTypes" pattern to provide
 * strongly-typed helpers for settings, commands, and UI components.
 * By declaring this interface, we tell the library:
 *   - "plugin" → the concrete Plugin class (for `this` typing)
 *   - "pluginSettings" → the settings data shape
 *   - "pluginSettingsManager" → the manager that persists settings
 *   - "pluginSettingsTab" → the settings UI tab class
 *
 * This means `PluginBase<PluginTypes>` gives us fully typed access to
 * `this.settings`, `this.settingsManager`, etc., without any `any` casts.
 */
export interface PluginTypes extends PluginTypesBase {
  plugin: Plugin;
  pluginSettings: PluginSettings;
  pluginSettingsManager: PluginSettingsManager;
  pluginSettingsTab: PluginSettingsTab;
}
