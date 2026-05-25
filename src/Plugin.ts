import type { ExtractPluginSettingsWrapper } from 'obsidian-dev-utils/obsidian/Plugin/PluginTypesBase';
import type { ReadonlyDeep } from 'type-fest';

import { Notice } from 'obsidian';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import type { ChatClient } from './ChatClient.ts';
import type { PluginTypes } from './PluginTypes.ts';

import { AcpClient } from './AcpClient.ts';
import { AuditLog } from './AuditLog.ts';
import { DebugLogger } from './DebugLogger.ts';
import { FileChangeManager } from './FileChangeManager.ts';
import { HermesApiClient } from './HermesApiClient.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { SecretsManager } from './SecretsManager.ts';
import { clearAllCommands } from './SlashCommands.ts';
import {
 ghostTextExtension,
setGhostTextEffect
} from './styles/GhostTextExtension.ts';
import {
 inlineDiffExtension
} from './styles/InlineDiffExtension.ts';
import { VaultManager } from './VaultManager.ts';
import {
  HERMES_CHAT_VIEW_TYPE,
  HermesChatView
} from './Views/HermesChatView.tsx';

export class Plugin extends PluginBase<PluginTypes> {
  public acpClient!: AcpClient;
  public apiClient!: HermesApiClient;
  public auditLog!: AuditLog;
  public debug!: DebugLogger;
  public fileChangeManager!: FileChangeManager;
  public secrets!: SecretsManager;
  public vaultManager!: VaultManager;
  public activeEditorView?: any;
  private ribbonBadgeEl?: HTMLElement;

  /**
   * Get the active chat client based on connection mode.
   */
  public getChatClient(): ChatClient {
    return this.settings.connectionMode === 'api' ? this.apiClient : this.acpClient;
  }

  /**
   * Open the plugin settings tab.
   */
  public openSettings(): void {
    // Access internal Obsidian API not exposed in public types
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
    this.secrets = new SecretsManager(this);
    this.fileChangeManager = new FileChangeManager(this);
    this.auditLog = new AuditLog(this);
    this.debug = new DebugLogger(this);
    this.acpClient = new AcpClient(this);
    this.apiClient = new HermesApiClient(this, this.secrets);

    // Connect on load using the configured mode
    const client = this.getChatClient();
    client.connect().catch((err) => {
      this.debug.error('Initial connection failed', err);
    });

    this.registerView(HERMES_CHAT_VIEW_TYPE, (leaf) => new HermesChatView(leaf, this));

    // Register CodeMirror 6 extensions for inline ghost text and diff
    this.registerEditorExtension(ghostTextExtension);
    this.registerEditorExtension(inlineDiffExtension);

    // Add ribbon icon for Hermes chat
    const ribbonIconEl = this.addRibbonIcon('message-square', 'Open Hermes Chat', () => {
      this.openView(HERMES_CHAT_VIEW_TYPE).catch((err) => {
        this.debug.error('Failed to open view', err);
      });
    });

    ribbonIconEl.classList.add('hermes-ribbon-icon');
    this.ribbonBadgeEl = ribbonIconEl.createSpan({ cls: 'hermes-ribbon-badge' });
    this.ribbonBadgeEl.style.display = 'none';

    const updateBadge = (): void => {
      const fileChanges = this.fileChangeManager.getPendingChanges().length;
      const perms = this.acpClient.getPendingPermissions().length;
      const total = fileChanges + perms;
      if (this.ribbonBadgeEl) {
        this.ribbonBadgeEl.style.display = total > 0 ? 'flex' : 'none';
        this.ribbonBadgeEl.textContent = total > 0 ? String(total) : '';
      }
    };

    this.fileChangeManager.onChanges(updateBadge);
    this.acpClient.onPermissionsChange(updateBadge);

    // Add command to open Hermes chat view
    this.addCommand({
      callback: () => {
        this.openView(HERMES_CHAT_VIEW_TYPE).catch((err) => {
          this.debug.error('Failed to open view', err);
        });
      },
      id: 'open-hermes-chat',
      name: 'Open Hermes Chat'
    });

    // Add command to toggle Hermes chat view
    this.addCommand({
      callback: () => {
        this.toggleView(HERMES_CHAT_VIEW_TYPE).catch((err) => {
          this.debug.error('Failed to toggle view', err);
        });
      },
      hotkeys: [
        {
          key: 'H',
          modifiers: ['Mod']
        }
      ],
      id: 'toggle-hermes-chat',
      name: 'Toggle Hermes Chat'
    });

    // Add command to focus chat input (when chat is open)
    this.addCommand({
      callback: () => {
        this.focusChatInput().catch((err) => {
          this.debug.error('Failed to focus input', err);
        });
      },
      hotkeys: [
        {
          key: 'H',
          modifiers: ['Mod', 'Shift']
        }
      ],
      id: 'focus-hermes-chat-input',
      name: 'Focus Hermes Chat Input'
    });

    // Add command to trigger inline completion (Ghost Text)
    this.addCommand({
      editorCallback: async (editor) => {
        // @ts-expect-error - Accessing internal CodeMirror 6 view from Obsidian's Editor wrapper
        const cmView = editor.cm;
        if (!cmView) { return; }

        // Store the active editor view for use by FileChangeManager
        this.activeEditorView = cmView;

        const pos = editor.posToOffset(editor.getCursor());
        cmView.dispatch({
          effects: setGhostTextEffect.of({ alternatives: [' ...Hermes is thinking...'], currentIndex: 0, pos })
        });

        try {
          const doc = cmView.state.doc.toString();
          const prefix = doc.slice(Math.max(0, pos - 1000), pos);
          const suffix = doc.slice(pos, pos + 1000);

          const systemPrompt = 'You are an inline auto-completion assistant. Continue the text naturally based on the prefix and suffix context. Do NOT repeat the prefix. ONLY output the exact text that should be inserted at the cursor position. Keep it concise.';
          const userText = `<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>`;

          const completion = await this.apiClient.getInlineCompletion(systemPrompt, userText);

          if (completion) {
            // Only show if the cursor hasn't moved while we were waiting
            const currentPos = editor.posToOffset(editor.getCursor());
            if (currentPos === pos) {
              cmView.dispatch({ effects: setGhostTextEffect.of({ alternatives: [completion], currentIndex: 0, pos }) });
            } else {
              cmView.dispatch({ effects: setGhostTextEffect.of(null) });
            }
          } else {
            cmView.dispatch({ effects: setGhostTextEffect.of(null) });
          }
        } catch (error) {
          this.debug.error('Inline completion failed', error);
          cmView.dispatch({ effects: setGhostTextEffect.of(null) });
        }
      },
      id: 'hermes-inline-suggest',
      name: 'Trigger Inline Suggestion'
    });

    // Shared rate limiter for command palette commands
    let lastCommandSendTime = 0;
    const COMMAND_RATE_LIMIT_MS = 2000;
    const checkRateLimit = (): boolean => {
      const now = Date.now();
      if (now - lastCommandSendTime < COMMAND_RATE_LIMIT_MS) {
        new Notice('Please wait a moment before sending another command.');
        return false;
      }
      lastCommandSendTime = now;
      return true;
    };

    // Command Palette: Ask Hermes about selection
    this.addCommand({
      editorCallback: async (editor, _view) => {
        if (!checkRateLimit()) { return; }
        const selection = editor.getSelection();
        if (!selection.trim()) {
          new Notice('No text selected. Select some text first.');
          return;
        }

        await this.openView(HERMES_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(HERMES_CHAT_VIEW_TYPE);
        if (leaves.length === 0) { return; }

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof HermesChatView)) { return; }

        const contextItems = [{
          id: `selection-${Date.now()}`,
          text: selection.slice(0, 50) + (selection.length > 50 ? '...' : ''),
          type: 'selection' as const
        }];

        await chatView.sendPrompt(`Please explain or elaborate on the following:\n\n${selection}`, contextItems);
      },
      id: 'hermes-ask-selection',
      name: 'Ask Hermes about selection'
    });

    // Command Palette: Summarize current note
    this.addCommand({
      callback: async () => {
        if (!checkRateLimit()) { return; }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to summarize.');
          return;
        }

        await this.openView(HERMES_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(HERMES_CHAT_VIEW_TYPE);
        if (leaves.length === 0) { return; }

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof HermesChatView)) { return; }

        const contextItems = [{
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        }];

        await chatView.sendPrompt('Please provide a concise summary of this note.', contextItems);
      },
      id: 'hermes-summarize-note',
      name: 'Summarize current note with Hermes'
    });

    // Command Palette: Generate tags for current note
    this.addCommand({
      callback: async () => {
        if (!checkRateLimit()) { return; }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to generate tags for.');
          return;
        }

        await this.openView(HERMES_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(HERMES_CHAT_VIEW_TYPE);
        if (leaves.length === 0) { return; }

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof HermesChatView)) { return; }

        const contextItems = [{
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        }];

        await chatView.sendPrompt('Generate 3-5 relevant tags for this note. Return them as a comma-separated list.', contextItems);
      },
      id: 'hermes-generate-tags',
      name: 'Generate tags for current note'
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
    this.acpClient?.disconnect();
    this.apiClient?.disconnect();
    clearAllCommands();
    await super.onunloadImpl();
  }

  private async focusChatInput(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(HERMES_CHAT_VIEW_TYPE);
    if (leaves.length === 0) {
      await this.openView(HERMES_CHAT_VIEW_TYPE);
      return;
    }

    await this.app.workspace.revealLeaf(leaves[0]!);
    // Focus the textarea after a short delay to allow the view to render
    window.setTimeout(() => {
      const container = leaves[0]!.view.containerEl;
      const textarea = container.querySelector('.hermes-input') as HTMLElement | null;
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }

  private async openView(viewType: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      await this.app.workspace.revealLeaf(leaves[0]!);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ active: true, type: viewType });
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  private async toggleView(viewType: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      // If the view is active, close it; otherwise reveal it
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf?.view?.getViewType() === viewType) {
        await this.app.workspace.detachLeavesOfType(viewType);
      } else if (activeLeaf) {
        await this.app.workspace.revealLeaf(leaves[0]!);
      }
      return;
    }

    // Open if not exists
    await this.openView(viewType);
  }
}
