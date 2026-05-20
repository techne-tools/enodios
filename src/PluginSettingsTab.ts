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

    this.renderConnectionSection();
    this.renderAgentIdentitySection();
    this.renderChatDisplaySection();
    this.renderContextSection();
    this.renderConversationStorageSection();
    this.renderFeedbackSection();
    this.renderSecuritySection();
    this.renderDebugSection();
  }

  // ─── Agent Identity ───
  private renderAgentIdentitySection(): void {
    this.containerEl.createEl('h3', { text: '🤖 Agent Personality' });

    new SettingEx(this.containerEl)
      .setName('Agent Display Name')
      .setDesc('What you call your assistant in the chat. Change it to whatever feels right — "Claude", "Friday", "Research Buddy", etc.')
      .addText((text) => {
        text.setPlaceholder('Hermes')
          .setValue(this.plugin.settings.chatAgentName);
        this.bind(text, 'chatAgentName');
      });
  }

  // ─── Chat Display ───
  private renderChatDisplaySection(): void {
    this.containerEl.createEl('h3', { text: '💬 What You See in Chat' });

    new SettingEx(this.containerEl)
      .setName('Show Reasoning Steps')
      .setDesc('When the agent "thinks out loud" before answering, show those thoughts in the chat. Useful for understanding how it reached a conclusion.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showReasoning);
        this.bind(toggle, 'showReasoning');
      });

    new SettingEx(this.containerEl)
      .setName('Show Tool Use')
      .setDesc('Show a notice when the agent reads a file, searches your vault, or runs a command. Helpful for understanding what it is doing behind the scenes.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showToolUse);
        this.bind(toggle, 'showToolUse');
      });

    new SettingEx(this.containerEl)
      .setName('Show Token Count')
      .setDesc('Display the real-time token usage counter in the chat footer. Shows input/output tokens and estimated cost per conversation.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showTokenCount);
        this.bind(toggle, 'showTokenCount');
      });
  }

  // ─── Connection ───
  private renderConnectionSection(): void {
    this.containerEl.createEl('h3', { text: '🔌 How Hermes Connects' });

    new SettingEx(this.containerEl)
      .setName('Connection Mode')
      .setDesc('Choose how Hermes talks to your AI agent. "Local" runs on your computer (fastest, private). "Remote" connects to a server (good for teams or powerful GPUs).')
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
      new SettingEx(this.containerEl)
        .setName('Hermes Program Location')
        .setDesc('If Hermes is not in your system PATH, paste the full file path here. Leave blank to let the plugin find it automatically.')
        .addText((text) => {
          text.setPlaceholder('/Users/yourname/.local/bin/hermes')
            .setValue(this.plugin.settings.hermesBinaryPath);
          this.bind(text, 'hermesBinaryPath');
        });

      new SettingEx(this.containerEl)
        .setName('Test Local Connection')
        .setDesc('Make sure Hermes is installed and reachable.')
        .addButton((button) => {
          button.setButtonText('Test Connection')
            .onClick(async () => {
              await this.testAcpConnection();
            });
        });

      new SettingEx(this.containerEl)
        .setName('Extra Tools (MCP Servers)')
        .setDesc('Add paths to extra tool servers, one per line. These let Hermes do things like search the web or query databases. You must restart the connection after changing this.')
        .addTextArea((text) => {
          text.setPlaceholder('/path/to/web-search-server\n/path/to/database-server')
            .setValue(this.plugin.settings.mcpServersList);
          text.inputEl.rows = 3;
          text.inputEl.style.width = '100%';
          this.bind(text, 'mcpServersList');
        });
    }

    // Remote mode settings
    if (this.plugin.settings.connectionMode === 'api') {
      new SettingEx(this.containerEl)
        .setName('Server Address')
        .setDesc('The web address of your Hermes server.')
        .addText((text) => {
          text.setPlaceholder('http://127.0.0.1:8642')
            .setValue(this.plugin.settings.hermesApiUrl);
          this.bind(text, 'hermesApiUrl');
        });

      new SettingEx(this.containerEl)
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

      new SettingEx(this.containerEl)
        .setName('Agent Name on Server')
        .setDesc('The name your server knows this agent by. Usually "hermes-agent" unless your admin changed it.')
        .addText((text) => {
          text.setPlaceholder('hermes-agent')
            .setValue(this.plugin.settings.hermesAgentName);
          this.bind(text, 'hermesAgentName');
        });

      new SettingEx(this.containerEl)
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
  private renderContextSection(): void {
    this.containerEl.createEl('h3', { text: '📎 Automatic Context' });

    new SettingEx(this.containerEl)
      .setName('Auto-Add Open Note')
      .setDesc('When you switch to a different note, automatically include it in the conversation context. This saves you from clicking the @ button every time.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.contextEntireNote);
        this.bind(toggle, 'contextEntireNote');
      });
  }

  // ─── Conversation Storage ───
  private renderConversationStorageSection(): void {
    this.containerEl.createEl('h3', { text: '🗂️ Saving Conversations' });

    new SettingEx(this.containerEl)
      .setName('Save Folder')
      .setDesc('Where conversation files are stored in your vault. Default is a folder called "hermes".')
      .addText((text) => {
        text.setPlaceholder('hermes')
          .setValue(this.plugin.settings.chatSaveFolder);
        this.bind(text, 'chatSaveFolder');
      });

    new SettingEx(this.containerEl)
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
  private renderDebugSection(): void {
    this.containerEl.createEl('h3', { text: '🐛 Troubleshooting' });

    new SettingEx(this.containerEl)
      .setName('Debug Mode')
      .setDesc('Write detailed technical logs to the browser console. Turn this on when something is broken and you need to report a bug. You can view the console with Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux).')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableDebugMode);
        this.bind(toggle, 'enableDebugMode');
      });

    new SettingEx(this.containerEl)
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

    new SettingEx(this.containerEl)
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
  private renderFeedbackSection(): void {
    this.containerEl.createEl('h3', { text: '🔊 Sound & Feel' });

    new SettingEx(this.containerEl)
      .setName('Typing Sounds')
      .setDesc('Play a soft click sound while the agent is writing a response. Makes it feel more like a real conversation.')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTypingSound);
        this.bind(toggle, 'enableTypingSound');
      });

    new SettingEx(this.containerEl)
      .setName('Haptic Feedback')
      .setDesc('Vibrate briefly when the agent starts responding. Only works on devices with vibration support (most phones and some laptops).')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableHapticFeedback);
        this.bind(toggle, 'enableHapticFeedback');
      });
  }

  // ─── Security ───
  private renderSecuritySection(): void {
    this.containerEl.createEl('h3', { text: '🛡️ Security' });

    new SettingEx(this.containerEl)
      .setName('Allow Terminal Commands')
      .setDesc('⚠️ DANGER: This lets the agent run shell commands on your computer — things like deleting files, installing software, or accessing the internet. These commands bypass the file-change approval system. ONLY enable this if you completely trust the agent and understand the risks.')
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
