import type { ExtractPluginSettingsWrapper } from 'obsidian-dev-utils/obsidian/Plugin/PluginTypesBase';
import type { ReadonlyDeep } from 'type-fest';

import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import type { PluginTypes } from './PluginTypes.ts';

import { AcpClient } from './AcpClient.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { VaultManager } from './VaultManager.ts';
import {
  HERMES_CHAT_VIEW_TYPE,
  HermesChatView
} from './Views/HermesChatView.tsx';

export class Plugin extends PluginBase<PluginTypes> {
  public acpClient!: AcpClient;
  public vaultManager!: VaultManager;
  /**
   * Open the plugin settings tab.
   */
  public openSettings(): void {
    (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.open();
    (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting.openTabById(this.manifest.id);
  }

  protected override createSettingsManager(): PluginSettingsManager {
    return new PluginSettingsManager(this);
  }

  protected override createSettingsTab(): null | PluginSettingsTab {
    return new PluginSettingsTab(this);
  }

  protected override async onLayoutReady(): Promise<void> {
    await super.onLayoutReady();
  }

  protected override async onloadImpl(): Promise<void> {
    await super.onloadImpl();

    this.vaultManager = new VaultManager(this);
    this.acpClient = new AcpClient(this);

    // Connect to ACP on load
    this.acpClient.connect().catch(() => {
      // Silently ignore connection errors - will retry on first message
    });

    this.registerView(HERMES_CHAT_VIEW_TYPE, (leaf) => new HermesChatView(leaf, this));

    // Add ribbon icon for Hermes chat
    this.addRibbonIcon('message-square', 'Open Hermes Chat', () => {
      this.openView(HERMES_CHAT_VIEW_TYPE).catch(() => {
        // Silently ignore view open errors
      });
    });

    // Add command to open Hermes chat view
    this.addCommand({
      callback: () => {
        this.openView(HERMES_CHAT_VIEW_TYPE).catch(() => {
          // Silently ignore view open errors
        });
      },
      id: 'open-hermes-chat',
      name: 'Open Hermes Chat'
    });

    // Add command to toggle Hermes chat view
    this.addCommand({
      callback: () => {
        this.toggleView(HERMES_CHAT_VIEW_TYPE).catch(() => {
          // Silently ignore view toggle errors
        });
      },
      id: 'toggle-hermes-chat',
      name: 'Toggle Hermes Chat',
      hotkeys: [
        {
          modifiers: ['Mod'],
          key: 'H'
        }
      ]
    });

    // Add command to focus chat input (when chat is open)
    this.addCommand({
      callback: () => {
        this.focusChatInput().catch(() => {
          // Silently ignore focus errors
        });
      },
      id: 'focus-hermes-chat-input',
      name: 'Focus Hermes Chat Input',
      hotkeys: [
        {
          modifiers: ['Mod', 'Shift'],
          key: 'H'
        }
      ]
    });
  }

  protected override async onLoadSettings(
    loadedSettings: ReadonlyDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    isInitialLoad: boolean
  ): Promise<void> {
    await super.onLoadSettings(loadedSettings, isInitialLoad);
  }

  protected override async onSaveSettings(
    newSettings: ReadonlyDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    oldSettings: ReadonlyDeep<ExtractPluginSettingsWrapper<PluginTypes>>,
    context: unknown
  ): Promise<void> {
    await super.onSaveSettings(newSettings, oldSettings, context);
  }

  protected override async onunloadImpl(): Promise<void> {
    await super.onunloadImpl();
  }

  private async openView(viewType: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    const existingLeaf = leaves.length > 0 ? leaves[0] : null;
    if (existingLeaf !== null) {
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf !== null) {
      await leaf.setViewState({ active: true, type: viewType });
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  private async toggleView(viewType: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    const existingLeaf = leaves.length > 0 ? leaves[0] : null;
    if (existingLeaf !== null) {
      // If the view is active, close it; otherwise reveal it
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf?.view?.getViewType() === viewType) {
        await this.app.workspace.detachLeavesOfType(viewType);
      } else {
        await this.app.workspace.revealLeaf(existingLeaf);
      }
      return;
    }

    // Open if not exists
    await this.openView(viewType);
  }

  private async focusChatInput(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(HERMES_CHAT_VIEW_TYPE);
    const leaf = leaves.length > 0 ? leaves[0] : null;
    if (leaf === null) {
      await this.openView(HERMES_CHAT_VIEW_TYPE);
      return;
    }

    await this.app.workspace.revealLeaf(leaf);
    // Focus the textarea after a short delay to allow the view to render
    window.setTimeout(() => {
      const container = leaf.view.containerEl;
      const textarea = container.querySelector('.hermes-input') as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }
}
