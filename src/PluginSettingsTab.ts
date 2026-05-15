import { Notice } from 'obsidian';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    // Hermes Agent API Configuration Section
    new SettingEx(this.containerEl)
      .setName('Hermes Agent API URL')
      .setDesc('URL of the Hermes Agent API server (default: http://127.0.0.1:8642)')
      .addText((text) => {
        text.setPlaceholder('http://127.0.0.1:8642')
          .setValue(this.plugin.settings.hermesApiUrl);
        this.bind(text, 'hermesApiUrl');
        // Ensure paste is enabled
        text.inputEl.addEventListener('paste', (e) => {
          e.preventDefault();
          const textData = e.clipboardData.getData('text');
          document.execCommand('insertText', false, textData);
        });
      });

    new SettingEx(this.containerEl)
      .setName('Hermes Agent API Key')
      .setDesc('API key for Hermes Agent (required)')
      .addText((text) => {
        text.setPlaceholder('Enter API key')
          .setValue(this.plugin.settings.hermesApiKey);
        this.bind(text, 'hermesApiKey');
        // Ensure paste is enabled
        text.inputEl.addEventListener('paste', (e) => {
          e.preventDefault();
          const textData = e.clipboardData.getData('text');
          document.execCommand('insertText', false, textData);
        });
      });

    new SettingEx(this.containerEl)
      .setName('Agent Name')
      .setDesc('Name of the Hermes Agent (default: hermes-agent)')
      .addText((text) => {
        text.setPlaceholder('hermes-agent')
          .setValue(this.plugin.settings.hermesAgentName);
        this.bind(text, 'hermesAgentName');
        // Ensure paste is enabled
        text.inputEl.addEventListener('paste', (e) => {
          e.preventDefault();
          const textData = e.clipboardData.getData('text');
          document.execCommand('insertText', false, textData);
        });
      });

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

    // Test Connection Button
    new SettingEx(this.containerEl)
      .setName('Test Connection')
      .setDesc('Test the connection to the Hermes Agent API')
      .addButton((button) => {
        button.setButtonText('Test')
          .onClick(async () => {
            await this.testConnection();
          });
      });
  }

  private async testConnection(): Promise<void> {
    const { hermesApiKey, hermesApiUrl } = this.plugin.settings;

    if (!hermesApiUrl) {
      new Notice('Please enter a valid API URL');
      return;
    }

    try {
      const response = await fetch(`${hermesApiUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${hermesApiKey}`,
          'Content-Type': 'application/json'
        },
        method: 'GET'
      });

      if (response.ok) {
        new Notice('Connection successful! The Hermes Agent API is working.');
      } else {
        new Notice(`Connection failed: ${response.statusText}`);
      }
    } catch (error) {
      new Notice(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
