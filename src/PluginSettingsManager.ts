import { PluginSettingsManagerBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsManagerBase';

import type { PluginTypes } from './PluginTypes.ts';

import { PluginSettings } from './PluginSettings.ts';

/**
 * Manages persistence and validation of plugin settings.
 *
 * ARCHITECTURAL ROLE:
 * This is a thin wrapper around obsidian-dev-utils' PluginSettingsManagerBase.
 * It exists so that:
 * 1. The base class handles JSON serialization, file I/O, and migration hooks.
 * 2. We can add project-specific validators here (e.g. URL format checks,
 *    persona template validation) without cluttering Plugin.ts.
 * 3. Type safety is preserved — PluginTypes ties the settings shape to
 *    the Plugin class via generics.
 *
 * LIFECYCLE:
 * - Created once during plugin load by `createSettingsManager()`
 * - `createDefaultSettings()` provides the initial values when no saved data exists
 * - `onLoadRecord` / `onSavingRecord` are hooks for data migration between versions
 * - `registerValidators()` is where future validation rules should live
 */
export class PluginSettingsManager extends PluginSettingsManagerBase<PluginTypes> {
  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }

  protected override async onLoadRecord(record: Record<string, unknown>): Promise<void> {
    await super.onLoadRecord(record);
  }

  protected override async onSavingRecord(record: Record<string, unknown>): Promise<void> {
    await super.onSavingRecord(record);
  }

  protected override registerValidators(): void {
    super.registerValidators();
  }
}
