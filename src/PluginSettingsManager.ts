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

  protected override async onLoadRecord(
    record: Record<string, unknown>
  ): Promise<void> {
    await super.onLoadRecord(record);
  }

  protected override async onSavingRecord(
    record: Record<string, unknown>
  ): Promise<void> {
    await super.onSavingRecord(record);
  }

  protected override registerValidators(): void {
    super.registerValidators();

    // Validate enum settings so a manually-edited data.json can't corrupt the
    // save-folder layout or citation behavior.
    this.registerValidator('connectionMode', (value) => {
      const mode: string = value;
      if (mode !== 'acp' && mode !== 'api') {
        return 'connectionMode must be "acp" or "api"';
      }
      return undefined;
    });

    this.registerValidator('conversationOrganization', (value) => {
      const org: string = value;
      if (org !== 'flat' && org !== 'by-date') {
        return 'conversationOrganization must be "flat" or "by-date"';
      }
      return undefined;
    });

    this.registerValidator('citationStyle', (value) => {
      const style: string = value;
      if (
        style !== 'apa'
        && style !== 'chicago'
        && style !== 'harvard'
        && style !== 'ieee'
        && style !== 'mla'
      ) {
        return 'citationStyle must be "apa", "chicago", "harvard", "ieee", or "mla"';
      }
      return undefined;
    });

    // Validate the API URL is a well-formed http(s) URL.
    this.registerValidator('hermesApiUrl', (value) => {
      try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return 'hermesApiUrl must be an http(s) URL';
        }
      } catch {
        return 'hermesApiUrl must be a valid URL';
      }
      return undefined;
    });
  }
}
