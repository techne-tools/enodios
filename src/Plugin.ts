import type { ExtractPluginSettingsWrapper } from 'obsidian-dev-utils/obsidian/Plugin/PluginTypesBase';
import type { ReadonlyDeep } from 'type-fest';

import { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import { PluginBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginBase';

import type {
  ChatClient,
  ChatSessionUpdate
} from './ChatClient.ts';
import type { PluginTypes } from './PluginTypes.ts';

import { AcpClient } from './AcpClient.ts';
import { AuditLog } from './AuditLog.ts';
import { BasesManager } from './BasesManager.ts';
import { CanvasManager } from './CanvasManager.ts';
import { CitationManager } from './CitationManager.ts';
import { CommunityPluginsManager } from './CommunityPluginsManager.ts';
import { DebugLogger } from './DebugLogger.ts';
import { FileChangeManager } from './FileChangeManager.ts';
import { HermesApiClient } from './HermesApiClient.ts';
import { CitationSuggestModal } from './Modals/CitationSuggestModal.ts';
import { TagSuggestionModal } from './Modals/TagSuggestionModal.tsx';
import { NoteComposerManager } from './NoteComposerManager.ts';
import { NoteTemplateManager } from './NoteTemplateManager.ts';
import { OutlineManager } from './OutlineManager.ts';
import { PDFAnnotationManager } from './PDFAnnotationManager.ts';
import { PluginSettingsManager } from './PluginSettingsManager.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';
import { SecretsManager } from './SecretsManager.ts';
import { clearAllCommands } from './SlashCommands.ts';
import { SlidesManager } from './SlidesManager.ts';
import {
  ghostTextExtension,
  setGhostTextEffect
} from './styles/GhostTextExtension.ts';
import { inlineDiffExtension } from './styles/InlineDiffExtension.ts';
import { TagManager } from './TagManager.ts';
import { TemplateManager } from './TemplateManager.ts';
import { isPluginEnabled } from './utils/plugins.ts';
import { VaultManager } from './VaultManager.ts';
import {
  ENODIOS_CHAT_VIEW_TYPE,
  EnodiosChatView
} from './Views/EnodiosChatView.tsx';

export class Plugin extends PluginBase<PluginTypes> {
  public acpClient!: AcpClient;
  public apiClient!: HermesApiClient;
  public auditLog!: AuditLog;
  public basesManager!: BasesManager;
  public canvasManager!: CanvasManager;
  public communityPluginsManager!: CommunityPluginsManager;
  public debug!: DebugLogger;
  public fileChangeManager!: FileChangeManager;
  public noteComposerManager!: NoteComposerManager;
  public noteTemplateManager!: NoteTemplateManager;
  public outlineManager!: OutlineManager;
  public secrets!: SecretsManager;
  public slidesManager!: SlidesManager;
  public vaultManager!: VaultManager;
  public citationManager!: CitationManager;
  public pdfAnnotationManager!: PDFAnnotationManager;
  public tagManager!: TagManager;
  public templateManager!: TemplateManager;
  public activeEditorView?: EditorView;
  private ribbonBadgeEl?: HTMLElement;
  private statusBarItemEl?: HTMLElement;

  /**
   * Get the active chat client based on connection mode.
   */
  public getChatClient(): ChatClient {
    return this.settings.connectionMode === 'api' ? this.apiClient : this.acpClient;
  }

  /**
   * Open the plugin settings tab.
   *
   * NOTE: Obsidian's public TypeScript API does not expose the `setting`
   * property on `App`. We cast through `unknown` to access the internal
   * `open()` and `openTabById()` methods. This is a common pattern in
   * Obsidian plugin development when you need functionality not yet in
   * the public API surface.
   */
  public openSettings(): void {
    const appWithSettings = this.app as unknown as { setting: { open(): void; openTabById(id: string): void } };
    appWithSettings.setting.open();
    appWithSettings.setting.openTabById(this.manifest.id);
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
    this.citationManager = new CitationManager(this);
    this.pdfAnnotationManager = new PDFAnnotationManager(this);
    this.tagManager = new TagManager(this);
    this.templateManager = new TemplateManager(this);
    this.communityPluginsManager = new CommunityPluginsManager(this);
    this.basesManager = new BasesManager(this);
    this.canvasManager = new CanvasManager(this);
    this.noteComposerManager = new NoteComposerManager(this);
    this.noteTemplateManager = new NoteTemplateManager(this);
    this.outlineManager = new OutlineManager(this);
    this.slidesManager = new SlidesManager(this);

    this.statusBarItemEl = this.addStatusBarItem();
    this.statusBarItemEl.style.display = 'none';

    const handleSessionUpdate = (update: ChatSessionUpdate) => {
      if (update.type === 'stop') {
        this.updateStatusBar(false);
      } else if (update.type === 'message') {
        // Show subtle indicator that Hermes is processing
        this.updateStatusBar(true);
      }
    };

    this.acpClient.onUpdate(handleSessionUpdate);
    this.apiClient.onUpdate(handleSessionUpdate);

    // Connect on load using the configured mode
    const client = this.getChatClient();
    client.connect().catch((err) => {
      this.debug.error('Initial connection failed', err);
    });

    this.registerView(ENODIOS_CHAT_VIEW_TYPE, (leaf) => new EnodiosChatView(leaf, this));

    // Register CodeMirror 6 extensions for inline ghost text and diff
    this.registerEditorExtension(ghostTextExtension);
    this.registerEditorExtension(inlineDiffExtension);

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.fileChangeManager.handleActiveLeafChange();
      })
    );

    // Add ribbon icon for Enodios chat
    const ribbonIconEl = this.addRibbonIcon('message-square', 'Open Enodios Chat', () => {
      this.openView(ENODIOS_CHAT_VIEW_TYPE).catch((err) => {
        this.debug.error('Failed to open view', err);
      });
    });

    ribbonIconEl.classList.add('enodios-ribbon-icon');
    this.ribbonBadgeEl = ribbonIconEl.createSpan({ cls: 'enodios-ribbon-badge' });
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

    // Add command to open Enodios chat view
    this.addCommand({
      callback: () => {
        this.openView(ENODIOS_CHAT_VIEW_TYPE).catch((err) => {
          this.debug.error('Failed to open view', err);
        });
      },
      id: 'open-enodios-chat',
      name: 'Open Enodios Chat'
    });

    // Add command to toggle Enodios chat view
    this.addCommand({
      callback: () => {
        this.toggleView(ENODIOS_CHAT_VIEW_TYPE).catch((err) => {
          this.debug.error('Failed to toggle view', err);
        });
      },
      hotkeys: [
        {
          key: 'H',
          modifiers: ['Mod']
        }
      ],
      id: 'toggle-enodios-chat',
      name: 'Toggle Enodios Chat'
    });

    // Add command to focus Enodios chat input (when chat is open)
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
      id: 'focus-enodios-chat-input',
      name: 'Focus Enodios Chat Input'
    });

    // Add command to trigger inline completion (Ghost Text)
    this.addCommand({
      editorCallback: async (editor) => {
        // @ts-expect-error - Accessing internal CodeMirror 6 view from Obsidian's Editor wrapper
        const cmView = editor.cm;
        if (!cmView) return;

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

          const systemPrompt =
            'You are an inline auto-completion assistant. Continue the text naturally based on the prefix and suffix context. Do NOT repeat the prefix. ONLY output the exact text that should be inserted at the cursor position. Keep it concise.';
          const userText = `<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>`;

          const completions = await this.apiClient.getInlineCompletions(systemPrompt, userText);

          if (completions && completions.length > 0) {
            // Only show if the cursor hasn't moved while we were waiting
            const currentPos = editor.posToOffset(editor.getCursor());
            if (currentPos === pos) {
              cmView.dispatch({ effects: setGhostTextEffect.of({ alternatives: completions, currentIndex: 0, pos }) });
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
      id: 'enodios-inline-suggest',
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

    // Command Palette: Ask Enodios about selection
    this.addCommand({
      editorCallback: async (editor, _view) => {
        if (!checkRateLimit()) return;
        const selection = editor.getSelection();
        if (!selection.trim()) {
          new Notice('No text selected. Select some text first.');
          return;
        }

        await this.openView(ENODIOS_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(ENODIOS_CHAT_VIEW_TYPE);
        if (leaves.length === 0) return;

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof EnodiosChatView)) return;

        const contextItems = [{
          id: `selection-${Date.now()}`,
          text: selection.slice(0, 50) + (selection.length > 50 ? '...' : ''),
          type: 'selection' as const
        }];

        await chatView.sendPrompt(`Please explain or elaborate on the following:\n\n${selection}`, contextItems);
      },
      id: 'enodios-ask-selection',
      name: 'Ask Enodios about selection'
    });

    // Command Palette: Summarize current note
    this.addCommand({
      callback: async () => {
        if (!checkRateLimit()) return;
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to summarize.');
          return;
        }

        await this.openView(ENODIOS_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(ENODIOS_CHAT_VIEW_TYPE);
        if (leaves.length === 0) return;

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof EnodiosChatView)) return;

        const contextItems = [{
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        }];

        await chatView.sendPrompt('Please provide a concise summary of this note.', contextItems);
      },
      id: 'enodios-summarize-note',
      name: 'Summarize current note with Enodios'
    });

    // Command Palette: Generate tags for current note
    this.addCommand({
      callback: async () => {
        if (!checkRateLimit()) return;
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to generate tags for.');
          return;
        }

        await this.openView(ENODIOS_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(ENODIOS_CHAT_VIEW_TYPE);
        if (leaves.length === 0) return;

        const chatView = leaves[0]!.view;
        if (!(chatView instanceof EnodiosChatView)) return;

        const contextItems = [{
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        }];

        await chatView.sendPrompt('Generate 3-5 relevant tags for this note. Return them as a comma-separated list.', contextItems);
      },
      id: 'enodios-generate-tags',
      name: 'Generate tags for current note'
    });

    // Command: Insert Citation
    this.addCommand({
      callback: async () => {
        const items = await this.citationManager.loadBibliography();
        new CitationSuggestModal(this, items).open();
      },
      id: 'enodios-insert-citation',
      name: 'Insert Citation'
    });

    // Command: Generate Bibliography for Current Note
    this.addCommand({
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to generate bibliography for.');
          return;
        }
        const content = await this.app.vault.read(activeFile);
        const style = this.settings.citationStyle;
        const bib = this.citationManager.generateBibliographyForContent(content, style);
        if (!bib) {
          new Notice('No citations found in current note to generate bibliography for.');
          return;
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

        await this.app.vault.modify(activeFile, newContent);
        new Notice('Bibliography generated successfully');
      },
      id: 'enodios-generate-bibliography',
      name: 'Generate Bibliography for Current Note'
    });

    // Command: Suggest Tags for Current Note
    this.addCommand({
      callback: () => {
        new TagSuggestionModal(this).open();
      },
      id: 'enodios-suggest-tags',
      name: 'Suggest Tags for Current Note'
    });

    // Command: Generate Slides from active note
    this.addCommand({
      callback: async () => {
        if (!isPluginEnabled(this.app, 'slides')) {
          new Notice('Slides core plugin is not enabled.');
          return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to generate slides from.');
          return;
        }
        await this.openView(ENODIOS_CHAT_VIEW_TYPE);
        const leaves = this.app.workspace.getLeavesOfType(ENODIOS_CHAT_VIEW_TYPE);
        if (leaves.length === 0) return;
        const chatView = leaves[0]!.view;
        if (!(chatView instanceof EnodiosChatView)) return;
        const contextItems = [{
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        }];
        await chatView.sendPrompt(
          'Generate a Slides presentation from this note. Use `---` to separate slides. Start with a title slide (`# Title`), then use `##` for each section heading.',
          contextItems
        );
      },
      id: 'enodios-generate-slides',
      name: 'Generate Slides from active note'
    });

    // Command: Present active note with Slides
    this.addCommand({
      callback: async () => {
        if (!isPluginEnabled(this.app, 'slides')) {
          new Notice('Slides core plugin is not enabled.');
          return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('No active note to present.');
          return;
        }
        await this.slidesManager.openPresentationMode(activeFile);
      },
      id: 'enodios-present-slides',
      name: 'Present active note with Slides'
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
    this.fileChangeManager?.destroy();
    clearAllCommands();
    await super.onunloadImpl();
  }

  private async focusChatInput(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(ENODIOS_CHAT_VIEW_TYPE);
    if (leaves.length === 0) {
      await this.openView(ENODIOS_CHAT_VIEW_TYPE);
      return;
    }

    await this.app.workspace.revealLeaf(leaves[0]!);
    // Focus the textarea after a short delay to allow the view to render
    setTimeout(() => {
      const container = leaves[0]!.view.containerEl;
      const textarea = container.querySelector('.enodios-input') as HTMLElement | null;
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

  private updateStatusBar(isActive: boolean): void {
    if (!this.statusBarItemEl) return;
    if (isActive) {
      this.statusBarItemEl.textContent = '● Hermes';
      this.statusBarItemEl.style.display = 'inline-block';
      this.statusBarItemEl.classList.add('enodios-status-pulsing');
    } else {
      this.statusBarItemEl.textContent = '';
      this.statusBarItemEl.style.display = 'none';
      this.statusBarItemEl.classList.remove('enodios-status-pulsing');
    }
  }
}
