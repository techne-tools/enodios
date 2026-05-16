import { Notice } from 'obsidian';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    // Connection Mode
    new SettingEx(this.containerEl)
      .setName('Connection Mode')
      .setDesc('Choose how to connect to Hermes')
      .addDropdown((dropdown) => {
        dropdown.addOption('acp', 'ACP (local subprocess)');
        dropdown.addOption('api', 'API (REST server)');
        dropdown.setValue(this.plugin.settings.connectionMode);
        this.bind(dropdown, 'connectionMode', {
          onChanged: () => {
            this.display();
          }
        });
      });

    // ACP Settings
    if (this.plugin.settings.connectionMode === 'acp') {
      new SettingEx(this.containerEl)
        .setName('Hermes Binary Path')
        .setDesc('Full path to the hermes binary (optional — will auto-detect if empty)')
        .addText((text) => {
          text.setPlaceholder('/Users/chris/.local/bin/hermes')
            .setValue(this.plugin.settings.hermesBinaryPath);
          this.bind(text, 'hermesBinaryPath');
        });

      new SettingEx(this.containerEl)
        .setName('Test ACP Connection')
        .setDesc('Verify the ACP connection to Hermes')
        .addButton((button) => {
          button.setButtonText('Test')
            .onClick(async () => {
              await this.testAcpConnection();
            });
        });
    }

    // API Settings
    if (this.plugin.settings.connectionMode === 'api') {
      new SettingEx(this.containerEl)
        .setName('Hermes API URL')
        .setDesc('URL of the Hermes Agent API server')
        .addText((text) => {
          text.setPlaceholder('http://127.0.0.1:8642')
            .setValue(this.plugin.settings.hermesApiUrl);
          this.bind(text, 'hermesApiUrl');
        });

      new SettingEx(this.containerEl)
        .setName('Hermes API Key')
        .setDesc('API key for Hermes Agent (stored securely)')
        .addText((text) => {
          text.setPlaceholder('Enter API key')
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
        .setName('Agent Name')
        .setDesc('Name of the Hermes Agent (default: hermes-agent)')
        .addText((text) => {
          text.setPlaceholder('hermes-agent')
            .setValue(this.plugin.settings.hermesAgentName);
          this.bind(text, 'hermesAgentName');
        });

      new SettingEx(this.containerEl)
        .setName('Test API Connection')
        .setDesc('Verify the REST API connection to Hermes')
        .addButton((button) => {
          button.setButtonText('Test')
            .onClick(async () => {
              await this.testApiConnection();
            });
        });
    }

    new SettingEx(this.containerEl)
      .setName('Chat Agent Display Name')
      .setDesc('Friendly name shown in the chat UI (default: Hermes)')
      .addText((text) => {
        text.setPlaceholder('Hermes')
          .setValue(this.plugin.settings.chatAgentName);
        this.bind(text, 'chatAgentName');
      });

    // Context Selection Section
    new SettingEx(this.containerEl)
      .setName('Auto-Add Current Note')
      .setDesc('Automatically update context when a different note is opened (requires note to be in context first)')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.contextEntireNote);
        this.bind(toggle, 'contextEntireNote');
      });

    // Conversation Persistence Section
    new SettingEx(this.containerEl)
      .setName('Conversation Save Folder')
      .setDesc('Folder path where conversations will be saved (default: hermes)')
      .addText((text) => {
        text.setPlaceholder('hermes')
          .setValue(this.plugin.settings.chatSaveFolder);
        this.bind(text, 'chatSaveFolder');
      });
  }

  private async testAcpConnection(): Promise<void> {
    try {
      await this.plugin.acpClient.connect();
      new Notice('ACP connection successful! Hermes is ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`ACP connection failed: ${message}`);
    }
  }

  private async testApiConnection(): Promise<void> {
    try {
      await this.plugin.apiClient.connect();
      new Notice('API connection successful! Hermes is ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`API connection failed: ${message}`);
    }
  }
}
