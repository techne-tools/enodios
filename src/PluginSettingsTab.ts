import {
  Notice,
  TFile
} from 'obsidian';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

/**
 * Settings tab for the Hermes plugin.
 *
 * USER EXPERIENCE PRINCIPLES:
 * - Use plain language, not jargon. "Local mode" not "ACP subprocess".
 * - Group related settings under clear headings.
 * - Explain WHY a setting matters, not just what it does.
 * - Warn about security implications prominently.
 * - Keep the debug mode visible but clearly marked as "for troubleshooting".
 */
export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    this.containerEl.createEl('h2', { text: 'Hermes Plugin Settings' });

    this.renderCollapsibleSection('🔌 Connection Settings', (el) => this.renderConnectionSection(el));
    this.renderCollapsibleSection('🤖 Agent Personality', (el) => this.renderAgentIdentitySection(el));
    this.renderCollapsibleSection('💬 What You See in Chat', (el) => this.renderChatDisplaySection(el));
    this.renderCollapsibleSection('📎 Automatic Context', (el) => this.renderContextSection(el));
    this.renderCollapsibleSection('🎓 Academic, Citations & Toggles', (el) => this.renderAcademicSection(el));
    this.renderCollapsibleSection('🧩 Core Plugin Integrations', (el) => this.renderCorePluginSection(el));
    this.renderCollapsibleSection('🌍 Community Plugin Integrations', (el) => this.renderCommunityPluginSection(el));
    this.renderCollapsibleSection('🗂️ Saving Conversations', (el) => this.renderConversationStorageSection(el));
    this.renderCollapsibleSection('🔊 Sound & Feel', (el) => this.renderFeedbackSection(el));
    this.renderCollapsibleSection('🛡️ Security', (el) => this.renderSecuritySection(el));
    this.renderCollapsibleSection('🐛 Troubleshooting', (el) => this.renderDebugSection(el));
  }

  private renderCollapsibleSection(title: string, renderFunc: (el: HTMLElement) => void): void {
    const details = this.containerEl.createEl('details', { cls: 'hermes-settings-details' });
    details.createEl('summary', { text: title, cls: 'hermes-settings-summary' });
    const content = details.createEl('div', { cls: 'hermes-settings-content' });
    renderFunc(content);
  }

  // ─── Agent Identity ───
  private renderAgentIdentitySection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Agent Display Name')
      .setDesc('What you call your assistant in the chat. Change it to whatever feels right — "Claude", "Friday", "Research Buddy", etc.')
      .addText((text) => {
        text.setPlaceholder('Hermes')
          .setValue(this.plugin.settings.chatAgentName);
        this.bind(text, 'chatAgentName');
      });
  }

  // ─── Chat Display ───
  private renderChatDisplaySection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Show Reasoning Steps')
      .setDesc('When the agent "thinks out loud" before answering, show those thoughts in the chat. Useful for understanding how it reached a conclusion.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showReasoning);
        this.bind(toggle, 'showReasoning');
      });

    new SettingEx(containerEl)
      .setName('Show Tool Use')
      .setDesc(
        'Show a notice when the agent reads a file, searches your vault, or runs a command. Helpful for understanding what it is doing behind the scenes.'
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showToolUse);
        this.bind(toggle, 'showToolUse');
      });

    new SettingEx(containerEl)
      .setName('Show Token Count')
      .setDesc('Display the real-time token usage counter in the chat footer. Shows input/output tokens and estimated cost per conversation.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showTokenCount);
        this.bind(toggle, 'showTokenCount');
      });

    new SettingEx(containerEl)
      .setName('Show Pending Changes in Chat')
      .setDesc(
        'Show the pending file changes panel in the chat view. When disabled, you can review and approve/reject edits exclusively using the inline diff view in the note editor.'
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showPendingChangesInChat);
        this.bind(toggle, 'showPendingChangesInChat');
      });
  }

  // ─── Connection ───
  private renderConnectionSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Connection Mode')
      .setDesc(
        'Choose how Hermes talks to your AI agent. "Local" runs on your computer (fastest, private). "Remote" connects to a server (good for teams or powerful GPUs).'
      )
      .addDropdown((dropdown) => {
        dropdown.addOption('acp', 'Local — runs on this computer');
        dropdown.addOption('api', 'Remote — connects to a server');
        dropdown.setValue(this.plugin.settings.connectionMode);
        this.bind(dropdown, 'connectionMode', {
          onChanged: () => {
            this.display();
          }
        });
      });

    // Local mode settings
    if (this.plugin.settings.connectionMode === 'acp') {
      new SettingEx(containerEl)
        .setName('Hermes Program Location')
        .setDesc('If Hermes is not in your system PATH, paste the full file path here. Leave blank to let the plugin find it automatically.')
        .addText((text) => {
          text.setPlaceholder('/Users/yourname/.local/bin/hermes')
            .setValue(this.plugin.settings.hermesBinaryPath);
          this.bind(text, 'hermesBinaryPath');
        });

      new SettingEx(containerEl)
        .setName('Test Local Connection')
        .setDesc('Make sure Hermes is installed and reachable.')
        .addButton((button) => {
          button.setButtonText('Test Connection')
            .onClick(async () => {
              await this.testAcpConnection();
            });
        });

      new SettingEx(containerEl)
        .setName('⚠️ Enable External Tool Servers (MCP)')
        .setDesc(
          'MCP servers are external programs that Hermes can call. They bypass file-approval and permission checks, and can execute arbitrary code with your user privileges. Only enable if you fully trust every server you add below.'
        )
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.mcpServersEnabled);
          this.bind(toggle, 'mcpServersEnabled', {
            onChanged: () => {
              this.display();
            }
          });
        });

      if (this.plugin.settings.mcpServersEnabled) {
        new SettingEx(containerEl)
          .setName('External Tool Server Paths')
          .setDesc('One absolute path per line. These executables run with your user privileges and are not sandboxed. Restart the connection after changing.')
          .addTextArea((text) => {
            text.setPlaceholder('/Users/you/.local/bin/mcp-web-search\n/opt/mcp-database')
              .setValue(this.plugin.settings.mcpServersList);
            text.inputEl.rows = 3;
            text.inputEl.style.width = '100%';
            this.bind(text, 'mcpServersList');
          });
      }
    }

    // Remote mode settings
    if (this.plugin.settings.connectionMode === 'api') {
      new SettingEx(containerEl)
        .setName('Server Address')
        .setDesc('The web address of your Hermes server.')
        .addText((text) => {
          text.setPlaceholder('http://127.0.0.1:8642')
            .setValue(this.plugin.settings.hermesApiUrl);
          this.bind(text, 'hermesApiUrl');
        });

      new SettingEx(containerEl)
        .setName('API Key')
        .setDesc('Your secret key for the server. This is stored securely and never shown again after saving.')
        .addText((text) => {
          text.setPlaceholder('Paste your key here')
            .setValue('');
          text.inputEl.type = 'password';
          text.onChange(async (value) => {
            if (value) {
              await this.plugin.secrets.set('apiKey', value);
              text.setValue('');
              new Notice('API key saved securely');
            }
          });
        });

      new SettingEx(containerEl)
        .setName('Agent Name on Server')
        .setDesc('The name your server knows this agent by. Usually "hermes-agent" unless your admin changed it.')
        .addText((text) => {
          text.setPlaceholder('hermes-agent')
            .setValue(this.plugin.settings.hermesAgentName);
          this.bind(text, 'hermesAgentName');
        });

      new SettingEx(containerEl)
        .setName('Test Remote Connection')
        .setDesc('Check that the server is online and your key works.')
        .addButton((button) => {
          button.setButtonText('Test Connection')
            .onClick(async () => {
              await this.testApiConnection();
            });
        });
    }
  }

  // ─── Context ───
  private renderContextSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Auto-Add Open Note')
      .setDesc(
        'When you switch to a different note, automatically include it in the conversation context. This saves you from clicking the @ button every time.'
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.contextEntireNote);
        this.bind(toggle, 'contextEntireNote');
      });
  }

  // ─── Academic & Citations ───
  private renderAcademicSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Enable Citations')
      .setDesc('Enable bibliography management, inline citation suggestions using [@, and Zotero integration.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableCitations);
        this.bind(toggle, 'enableCitations');
      });

    new SettingEx(containerEl)
      .setName('Enable PDF Integrations')
      .setDesc('Enable extracting highlights/comments from PDF files, page text extraction, and metadata extraction.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableAnnotations);
        this.bind(toggle, 'enableAnnotations');
      });

    new SettingEx(containerEl)
      .setName('Enable Auto-Tagging & Suggestions')
      .setDesc('Enable term-matching tag suggestions and frontmatter tags updating.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTags);
        this.bind(toggle, 'enableTags');
      });

    new SettingEx(containerEl)
      .setName('Bibliography File Path')
      .setDesc('Path to your bibliography file in the vault (e.g., "references.bib" or "references.json" for CSL JSON).')
      .addText((text) => {
        text.setPlaceholder('references.bib')
          .setValue(this.plugin.settings.bibliographyPath);
        this.bind(text, 'bibliographyPath');
      });

    new SettingEx(containerEl)
      .setName('Citation Style')
      .setDesc('The active style for formatting citations and bibliographies.')
      .addDropdown((dropdown) => {
        dropdown.addOption('apa', 'APA (7th edition)');
        dropdown.addOption('mla', 'MLA (9th edition)');
        dropdown.addOption('chicago', 'Chicago (Author-Date)');
        dropdown.addOption('ieee', 'IEEE');
        dropdown.setValue(this.plugin.settings.citationStyle);
        this.bind(dropdown, 'citationStyle');
      });

    new SettingEx(containerEl)
      .setName('Auto-Extract PDF Annotations')
      .setDesc('Automatically extract highlights and comments from PDF files when you attach them to the conversation context.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.autoExtractPdfAnnotations);
        this.bind(toggle, 'autoExtractPdfAnnotations');
      });
  }

  // ─── Core Plugin Integrations ───
  private renderCorePluginSection(containerEl: HTMLElement): void {
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Core plugin integrations are automatically enabled when the corresponding Obsidian core plugin is enabled in your vault.'
    });

    new SettingEx(containerEl)
      .setName('Note Templates Folder Override')
      .setDesc('Override the auto-detected Templates folder. Leave blank to use the folder configured in Settings → Core plugins → Templates.')
      .addText((text) => {
        text.setPlaceholder('e.g. Templates');
        text.setValue(this.plugin.settings.noteTemplatesFolder);
        this.bind(text, 'noteTemplatesFolder');
      });
  }

  // ─── Community Plugin Integrations ───
  private renderCommunityPluginSection(containerEl: HTMLElement): void {
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Hermes automatically integrates with these popular community plugins when they are enabled in your vault:'
    });

    const ul = containerEl.createEl('ul', { cls: 'hermes-settings-list' });
    ul.createEl('li').innerHTML = '<strong>Dataview:</strong> Use <code>/dataview &lt;query&gt;</code> to run queries directly in chat.';
    ul.createEl('li').innerHTML = '<strong>Templater:</strong> Use <code>/templater insert &lt;name&gt;</code> to insert templates into the active note.';
    ul.createEl('li').innerHTML =
      '<strong>Omnisearch:</strong> The <code>/search</code> command automatically uses Omnisearch for better fuzzy matching and OCR.';
    ul.createEl('li').innerHTML = '<strong>Excalidraw:</strong> Use <code>/excalidraw read &lt;path&gt;</code> to extract text elements from drawings.';
    ul.createEl('li').innerHTML =
      '<strong>Forge:</strong> Use <code>/forge validate</code> to read schemas from <code>System/Registry</code> or <code>/forge patch</code> to generate structural updates.';
    ul.createEl('li').innerHTML = '<strong>Lazy Loader:</strong> Use <code>/lazyloader analyze</code> to find plugins that might be slowing down startup.';
    ul.createEl('li').innerHTML =
      '<strong>Git:</strong> Use <code>/git commit</code> to auto-generate commit messages based on diffs, or <code>/git status</code> to view changes.';
    ul.createEl('li').innerHTML = '<strong>Linter:</strong> Use <code>/lint</code> to programmatically run the Obsidian Linter on the active file.';
    ul.createEl('li').innerHTML = '<strong>Prettier:</strong> Use <code>/prettier</code> to format the active file using Prettier.';
    ul.createEl('li').innerHTML = '<strong>Admonition:</strong> Use <code>/admonition insert &lt;type&gt;</code> to instruct Hermes to format callouts.';
    ul.createEl('li').innerHTML = '<strong>Advanced Tables:</strong> Use <code>/table generate</code> to generate strict, aligned markdown tables.';
    ul.createEl('li').innerHTML = '<strong>make.md:</strong> Use <code>/makemd</code> to instruct Hermes to generate spaces-compatible content.';
  }

  // ─── Conversation Storage ───
  private renderConversationStorageSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Save Folder')
      .setDesc('Where conversation files are stored in your vault. Default is a folder called "hermes".')
      .addText((text) => {
        text.setPlaceholder('hermes')
          .setValue(this.plugin.settings.chatSaveFolder);
        this.bind(text, 'chatSaveFolder');
      });

    new SettingEx(containerEl)
      .setName('Folder Organization')
      .setDesc('How to organize saved conversations. "Flat" puts everything in one folder. "By Date" groups them into monthly folders like 2026-05.')
      .addDropdown((dropdown) => {
        dropdown.addOption('flat', 'Flat — all in one folder');
        dropdown.addOption('by-date', 'By Date — monthly subfolders');
        dropdown.addOption('by-project', 'By Project — tag-based (coming soon)');
        dropdown.setValue(this.plugin.settings.conversationOrganization);
        this.bind(dropdown, 'conversationOrganization');
      });
  }

  // ─── Debug ───
  private renderDebugSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Debug Mode')
      .setDesc(
        'Write detailed technical logs to the browser console. Turn this on when something is broken and you need to report a bug. You can view the console with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux).'
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableDebugMode);
        this.bind(toggle, 'enableDebugMode');
      });

    new SettingEx(containerEl)
      .setName('View Audit Log')
      .setDesc('Open the audit log file that records every action the agent takes — file changes, tool calls, and permissions.')
      .addButton((button) => {
        button.setButtonText('Open Audit Log')
          .onClick(() => {
            const folder = this.plugin.settings.chatSaveFolder || 'hermes';
            const logPath = `${folder}/audit-log.md`;
            const file = this.plugin.app.vault.getAbstractFileByPath(logPath);
            if (file instanceof TFile) {
              this.plugin.app.workspace.getLeaf().openFile(file);
            } else {
              new Notice('Audit log not found yet. It is created after the first action.');
            }
          });
      });

    new SettingEx(containerEl)
      .setName('Reset Onboarding')
      .setDesc('Show the welcome message again the next time you open the chat.')
      .addButton((button) => {
        button.setButtonText('Reset')
          .onClick(() => {
            (this.plugin.settings as unknown as { hasSeenOnboarding: boolean }).hasSeenOnboarding = false;
            void this.plugin.settingsManager.saveToFile();
            new Notice('Welcome message will appear next time you open chat.');
          });
      });
  }

  // ─── Feedback ───
  private renderFeedbackSection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Typing Sounds')
      .setDesc('Play a soft click sound while the agent is writing a response. Makes it feel more like a real conversation.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTypingSound);
        this.bind(toggle, 'enableTypingSound');
      });

    new SettingEx(containerEl)
      .setName('Haptic Feedback')
      .setDesc('Vibrate briefly when the agent starts responding. Only works on devices with vibration support (most phones and some laptops).')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableHapticFeedback);
        this.bind(toggle, 'enableHapticFeedback');
      });
  }

  // ─── Security ───
  private renderSecuritySection(containerEl: HTMLElement): void {
    new SettingEx(containerEl)
      .setName('Allow Terminal Commands')
      .setDesc(
        '⚠️ DANGER: This lets the agent run shell commands on your computer — things like deleting files, installing software, or accessing the internet. These commands bypass the file-change approval system. ONLY enable this if you completely trust the agent and understand the risks.'
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.allowTerminal);
        this.bind(toggle, 'allowTerminal');
      });
  }

  private async testAcpConnection(): Promise<void> {
    try {
      await this.plugin.acpClient.connect();
      new Notice('Local connection successful! Hermes is ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Local connection failed: ${message}`);
    }
  }

  private async testApiConnection(): Promise<void> {
    try {
      await this.plugin.apiClient.connect();
      new Notice('Remote connection successful! Hermes is ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Remote connection failed: ${message}`);
    }
  }
}
