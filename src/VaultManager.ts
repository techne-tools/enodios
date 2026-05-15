import { Notice, TFile, TFolder, type Vault } from 'obsidian';

import type { Plugin } from './Plugin.ts';
import type { ChatMessage } from './Views/HermesChatView.tsx';

export interface ConversationMetadata {
  createdAt: number;
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Manages CRUD operations for conversation notes in the vault.
 */
export class VaultManager {
  private readonly plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get vault(): Vault {
    return this.plugin.app.vault;
  }

  /**
   * Get the configured save folder path.
   */
  private getSaveFolder(): string {
    return this.plugin.settings.chatSaveFolder || 'hermes';
  }

  /**
   * Ensure the save folder exists in the vault.
   */
  public async ensureSaveFolder(): Promise<TFolder> {
    const folderPath = this.getSaveFolder();
    const existingFolder = this.vault.getAbstractFileByPath(folderPath);

    if (existingFolder instanceof TFolder) {
      return existingFolder;
    }

    // Create folder and any parent folders
    return await this.vault.createFolder(folderPath);
  }

  /**
   * Generate a safe filename from a title.
   */
  private sanitizeFilename(title: string): string {
    return title
      .replace(/[^a-zA-Z0-9\s-_]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 100)
      .toLowerCase();
  }

  /**
   * Generate a unique file path for a conversation.
   */
  private generateFilePath(title: string, timestamp: number): string {
    const folder = this.getSaveFolder();
    const safeTitle = this.sanitizeFilename(title) || 'conversation';
    const dateStr = new Date(timestamp).toISOString().split('T')[0];
    return `${folder}/${safeTitle}-${dateStr}-${timestamp}.md`;
  }

  /**
   * Convert messages to markdown content with frontmatter.
   */
  private messagesToMarkdown(messages: ChatMessage[], title: string): string {
    const now = Date.now();
    const metadata: ConversationMetadata = {
      createdAt: messages[0]?.timestamp ?? now,
      id: `conv-${now}`,
      title,
      updatedAt: now
    };

    const frontmatter = [
      '---',
      `id: ${metadata.id}`,
      `title: ${metadata.title}`,
      `createdAt: ${metadata.createdAt}`,
      `updatedAt: ${metadata.updatedAt}`,
      'type: hermes-conversation',
      '---',
      ''
    ].join('\n');

    const body = messages.map((msg) => {
      const time = new Date(msg.timestamp).toLocaleString();
      const roleLabel = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**Hermes**' : '**System**';
      return `## ${roleLabel} — ${time}\n\n${msg.content}\n`;
    }).join('\n---\n\n');

    return `${frontmatter}\n${body}`;
  }

  /**
   * Parse markdown content back into messages.
   */
  private markdownToMessages(content: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const sections = content.split(/\n---\n/);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // Skip frontmatter
      if (trimmed.startsWith('---')) continue;

      // Parse header: ## **Role** — time
      const headerMatch = trimmed.match(/^## \*\*(.+?)\*\* — (.+?)\n\n/);
      if (!headerMatch) continue;

      const roleText = headerMatch[1].toLowerCase();
      const role = roleText === 'you' ? 'user' : roleText === 'hermes' ? 'assistant' : 'system';
      const contentText = trimmed.slice(headerMatch[0].length);

      messages.push({
        content: contentText.trim(),
        role,
        timestamp: Date.now()
      });
    }

    return messages;
  }

  /**
   * Save a conversation to the vault.
   * Returns the file path if successful.
   */
  public async saveConversation(messages: ChatMessage[], title?: string): Promise<string | null> {
    if (messages.length === 0) return null;

    try {
      await this.ensureSaveFolder();

      const conversationTitle = title || 'Conversation';
      const filePath = this.generateFilePath(conversationTitle, Date.now());
      const content = this.messagesToMarkdown(messages, conversationTitle);

      await this.vault.create(filePath, content);
      return filePath;
    } catch (error) {
      console.error('Failed to save conversation:', error);
      new Notice('Failed to save conversation to vault');
      return null;
    }
  }

  /**
   * Update an existing conversation file.
   */
  public async updateConversation(filePath: string, messages: ChatMessage[], title?: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    try {
      const conversationTitle = title || 'Conversation';
      const content = this.messagesToMarkdown(messages, conversationTitle);
      await this.vault.modify(file, content);
      return true;
    } catch (error) {
      console.error('Failed to update conversation:', error);
      return false;
    }
  }

  /**
   * Load a conversation from the vault.
   */
  public async loadConversation(filePath: string): Promise<{ messages: ChatMessage[]; title: string } | null> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;

    try {
      const content = await this.vault.read(file);
      const messages = this.markdownToMessages(content);

      // Extract title from frontmatter
      const titleMatch = content.match(/^title:\s*(.+)$/m);
      const title = titleMatch?.[1]?.trim() || 'Conversation';

      return { messages, title };
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return null;
    }
  }

  /**
   * Delete a conversation from the vault.
   */
  public async deleteConversation(filePath: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    try {
      await this.vault.trash(file, true);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      return false;
    }
  }

  /**
   * List all saved conversations.
   */
  public async listConversations(): Promise<Array<{ filePath: string; metadata: ConversationMetadata }>> {
    const folderPath = this.getSaveFolder();
    const folder = this.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      return [];
    }

    const conversations: Array<{ filePath: string; metadata: ConversationMetadata }> = [];

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        try {
          const content = await this.vault.read(child);
          const idMatch = content.match(/^id:\s*(.+)$/m);
          const titleMatch = content.match(/^title:\s*(.+)$/m);
          const createdMatch = content.match(/^createdAt:\s*(\d+)$/m);
          const updatedMatch = content.match(/^updatedAt:\s*(\d+)$/m);

          if (idMatch && titleMatch) {
            conversations.push({
              filePath: child.path,
              metadata: {
                createdAt: Number(createdMatch?.[1]) || child.stat.ctime,
                id: idMatch[1].trim(),
                title: titleMatch[1].trim(),
                updatedAt: Number(updatedMatch?.[1]) || child.stat.mtime
              }
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }

    // Sort by updatedAt descending
    conversations.sort((a, b) => b.metadata.updatedAt - a.metadata.updatedAt);
    return conversations;
  }

  /**
   * Create a new note in the vault.
   */
  public async createNote(filePath: string, content: string): Promise<TFile | null> {
    try {
      // Ensure parent folder exists
      const parts = filePath.split('/');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const parent = this.vault.getAbstractFileByPath(parentPath);
        if (!parent) {
          await this.vault.createFolder(parentPath);
        }
      }

      return await this.vault.create(filePath, content);
    } catch (error) {
      console.error('Failed to create note:', error);
      new Notice(`Failed to create note: ${filePath}`);
      return null;
    }
  }

  /**
   * Read a note from the vault.
   */
  public async readNote(filePath: string): Promise<string | null> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;

    try {
      return await this.vault.read(file);
    } catch (error) {
      console.error('Failed to read note:', error);
      return null;
    }
  }

  /**
   * Update an existing note in the vault.
   */
  public async updateNote(filePath: string, content: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    try {
      await this.vault.modify(file, content);
      return true;
    } catch (error) {
      console.error('Failed to update note:', error);
      return false;
    }
  }

  /**
   * Delete a note from the vault.
   */
  public async deleteNote(filePath: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return false;

    try {
      await this.vault.trash(file, true);
      return true;
    } catch (error) {
      console.error('Failed to delete note:', error);
      return false;
    }
  }
}
