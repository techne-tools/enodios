import type { Vault } from 'obsidian';

import {
 normalizePath,
Notice,
TFile,
TFolder
} from 'obsidian';

import type { Plugin } from './Plugin.ts';
import type { ChatMessage } from './Views/HermesChatView.tsx';

import { generateMessageId } from './utils/uuid.ts';

const FRONTMATTER_ID_REGEX = /^id:\s*(.+)$/m;
const FRONTMATTER_TITLE_REGEX = /^title:\s*(.+)$/m;
const FRONTMATTER_CREATED_REGEX = /^createdAt:\s*(\d+)$/m;
const FRONTMATTER_UPDATED_REGEX = /^updatedAt:\s*(\d+)$/m;
const MESSAGE_HEADER_REGEX = /^## \*\*(.+?)\*\* — (.+?)\n\n/;

export interface ConversationMetadata {
  /** Specific tools allowed for this session, bypassing global settings if provided */
  allowedTools?: string[];
  /** The timestamp when the conversation was originally created */
  createdAt: number;
  /** Unique identifier for the conversation (e.g., conv-12345678) */
  id: string;
  /** User-facing title generated from the first prompt or provided by the user */
  title: string;
  /** The timestamp of the most recent message in the conversation */
  updatedAt: number;
}

/**
 * Manages CRUD operations for conversation notes in the vault.
 *
 * ARCHITECTURAL ROLE:
 * VaultManager is the single point of contact between the plugin and Obsidian's
 * Vault API for file-system operations. It handles:
 *   - Folder creation (with recursive parent-folder handling)
 *   - Conversation persistence as markdown files with YAML frontmatter
 *   - Export to multiple formats (HTML, JSON, Markdown, PDF data URI)
 *   - Conversation listing and metadata extraction
 *
 * DESIGN DECISION: All folder creation goes through `ensureFolderExists()`
 * which walks the path segment-by-segment. This avoids the common pitfall
 * of `vault.createFolder()` failing when a parent directory doesn't exist.
 *
 * NOTE: This class does NOT handle the inline diff approval flow — that is
 * FileChangeManager's responsibility. VaultManager only writes files that
 * have already been approved (or are conversation exports created by the user).
 */
export class VaultManager {
  private readonly plugin: Plugin;

  private get vault(): Vault {
    return this.plugin.app.vault;
  }

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Create a new note in the vault.
   */
  public async createNote(filePath: string, content: string): Promise<null | TFile> {
    if (!this.isPathSafe(filePath)) { return null; }

    try {
      // Ensure parent folder exists
      const parts = filePath.split('/');
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        await this.ensureFolderExists(parentPath);
      }

      return await this.vault.create(filePath, content);
    } catch (error) {
      new Notice(`Failed to create note: ${filePath}`);
      return null;
    }
  }

  /**
   * Delete a conversation from the vault.
   */
  public async deleteConversation(filePath: string): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { return false; }

    try {
      await this.vault.trash(file, true);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete a note from the vault.
   */
  public async deleteNote(filePath: string): Promise<boolean> {
    if (!this.isPathSafe(filePath)) { return false; }

    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { return false; }

    try {
      await this.vault.trash(file, true);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Recursively create folders if they don't exist.
   */
  public async ensureFolderExists(folderPath: string): Promise<TFolder> {
    const parts = folderPath.split('/');
    let currentPath = '';
    let currentFolder: null | TFolder = null;

    for (const part of parts) {
      if (!part) { continue; }
      currentPath = currentPath === '' ? part : `${currentPath}/${part}`;
      const existing = this.vault.getAbstractFileByPath(currentPath);

      if (existing instanceof TFolder) {
        currentFolder = existing;
      } else if (existing) {
        throw new Error(`Path already exists but is not a folder: ${currentPath}`);
      } else {
        currentFolder = await this.vault.createFolder(currentPath);
      }
    }

    if (!currentFolder) {
      throw new Error(`Invalid folder path: ${folderPath}`);
    }

    return currentFolder;
  }

  /**
   * Ensure the save folder exists in the vault.
   */
  public async ensureSaveFolder(): Promise<TFolder> {
    const folderPath = this.getSaveFolder();
    return this.ensureFolderExists(folderPath);
  }

  /**
   * Export a conversation to HTML (self-contained).
   */
  public async exportToHtml(messages: ChatMessage[], title: string): Promise<string> {
    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;');
    };

    const messageHtml = messages.map((msg) => {
      const roleClass = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system';
      const roleLabel = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Hermes' : 'System';
      const time = new Date(msg.timestamp).toLocaleString();
      return `
        <div class="message ${roleClass}">
          <div class="message-header">
            <span class="role">${roleLabel}</span>
            <span class="time">${time}</span>
          </div>
          <div class="message-content">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
  h1 { text-align: center; color: #333; margin-bottom: 30px; }
  .message { margin-bottom: 16px; padding: 12px 16px; border-radius: 8px; }
  .message.user { background: #e3f2fd; margin-left: 40px; }
  .message.assistant { background: #fff; border: 1px solid #e0e0e0; margin-right: 40px; }
  .message.system { background: #f5f5f5; color: #666; font-size: 13px; text-align: center; }
  .message-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #666; }
  .message-content { line-height: 1.5; white-space: pre-wrap; }
  .role { font-weight: 600; }
  .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${messageHtml}
<div class="footer">Exported from Obsidian Hermes</div>
</body>
</html>`;
  }

  /**
   * Export a conversation to JSON.
   */
  public exportToJson(messages: ChatMessage[], title: string, metadata?: Record<string, unknown>): string {
    const data = {
      exportedAt: new Date().toISOString(),
      messages: messages.map((m) => ({
        content: m.content,
        id: m.id,
        role: m.role,
        timestamp: m.timestamp
      })),
      metadata,
      title,
      version: '1.0'
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Export a conversation to clean Markdown (no frontmatter, just messages).
   */
  public exportToMarkdown(messages: ChatMessage[], title: string): string {
    const header = `# ${title}\n\n*Exported from Obsidian Hermes on ${new Date().toLocaleString()}*\n\n---\n\n`;
    const body = messages.map((msg) => {
      const roleLabel = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Hermes' : 'System';
      const time = new Date(msg.timestamp).toLocaleString();
      return `## ${roleLabel} — ${time}\n\n${msg.content}\n`;
    }).join('\n---\n\n');
    return `${header}${body}`;
  }

  /**
   * Export a conversation to PDF by creating a printable HTML page.
   * Returns a data URI that can be opened for printing to PDF.
   * Caller MUST call revokeObjectURL on the returned string when done.
   */
  public async exportToPdfDataUri(messages: ChatMessage[], title: string): Promise<string> {
    const html = await this.exportToHtml(messages, title);
    const printStyles = `
      <style>
        @media print {
          body { background: white !important; }
          .message { page-break-inside: avoid; }
          .message.user { margin-left: 20px !important; }
          .message.assistant { margin-right: 20px !important; }
        }
      </style>
    `;
    const htmlWithPrint = html.replace('</head>', `${printStyles}</head>`);
    const blob = new Blob([htmlWithPrint], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }

  /**
   * List all saved conversations.
   */
  public async listConversations(): Promise<{ filePath: string; metadata: ConversationMetadata }[]> {
    const folderPath = this.getSaveFolder();
    const folder = this.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      return [];
    }

    const conversations: { filePath: string; metadata: ConversationMetadata }[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        try {
          let id: string | undefined;
          let title: string | undefined;
          let createdAt: number | undefined;
          let updatedAt: number | undefined;

          const cache = this.plugin.app.metadataCache.getFileCache(child);
          if (cache?.frontmatter) {
            id = cache.frontmatter['id'] ? String(cache.frontmatter['id']) : undefined;
            title = cache.frontmatter['title'] ? String(cache.frontmatter['title']) : undefined;
            createdAt = Number(cache.frontmatter['createdAt']) || undefined;
            updatedAt = Number(cache.frontmatter['updatedAt']) || undefined;
          }

          // Fallback to reading file if cache is missing (e.g. newly created file or in tests)
          if (!id || !title) {
            const content = await this.vault.read(child);
            const idMatch = FRONTMATTER_ID_REGEX.exec(content);
            const titleMatch = FRONTMATTER_TITLE_REGEX.exec(content);
            const createdMatch = FRONTMATTER_CREATED_REGEX.exec(content);
            const updatedMatch = FRONTMATTER_UPDATED_REGEX.exec(content);

            id = id || idMatch?.[1]?.trim();
            title = title || titleMatch?.[1]?.trim();
            createdAt = createdAt || Number(createdMatch?.[1] ?? '');
            updatedAt = updatedAt || Number(updatedMatch?.[1] ?? '');
          }

          if (id && title) {
            conversations.push({
              filePath: child.path,
              metadata: {
                createdAt: createdAt || child.stat.ctime,
                id: id.trim(),
                title: title.trim(),
                updatedAt: updatedAt || child.stat.mtime
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
   * Load a conversation from the vault.
   */
  public async loadConversation(filePath: string): Promise<{ allowedTools?: string[]; messages: ChatMessage[]; title: string } | null> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { return null; }

    try {
      const content = await this.vault.read(file);
      const messages = this.markdownToMessages(content);

      // Extract title from frontmatter
      let title = 'Conversation';
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.['title']) {
        title = String(cache.frontmatter['title']);
      } else {
        const titleMatch = /^title:\s*(.+)$/m.exec(content);
        if (titleMatch?.[1]) {
          title = titleMatch[1].trim();
        }
      }

      // Extract allowedTools from frontmatter
      let allowedTools: string[] | undefined;
      if (cache?.frontmatter?.['allowedTools']) {
        const raw = cache.frontmatter['allowedTools'];
        if (Array.isArray(raw)) {
          allowedTools = raw.map(String);
        } else if (typeof raw === 'string') {
          try {
            allowedTools = JSON.parse(raw) as string[];
          } catch {
            allowedTools = raw.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      }

      return { messages, title, ...(allowedTools ? { allowedTools } : {}) };
    } catch (error) {
      return null;
    }
  }

  /**
   * Read a note from the vault.
   */
  public async readNote(filePath: string): Promise<null | string> {
    if (!this.isPathSafe(filePath)) { return null; }

    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { return null; }

    try {
      return await this.vault.read(file);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save a conversation to the vault.
   * Returns the file path if successful.
   */
  public async saveConversation(messages: ChatMessage[], title?: string, allowedTools: null | string[] = null): Promise<null | string> {
    if (messages.length === 0) { return null; }

    try {
      const conversationTitle = title || 'Conversation';
      const filePath = this.generateFilePath(conversationTitle, Date.now());
      const content = this.messagesToMarkdown(messages, conversationTitle, allowedTools);

      // Ensure the full folder path (including date subfolders) exists before creating the file
      const folderPath = filePath.split('/').slice(0, -1).join('/');
      if (folderPath) {
        await this.ensureFolderExists(folderPath);
      }

      // Check if file already exists (shouldn't happen with timestamp, but safety first)
      const existing = this.vault.getAbstractFileByPath(filePath);
      if (existing) {
        console.warn(`[Hermes] Conversation file already exists: ${filePath}`);
      }

      await this.vault.create(filePath, content);
      return filePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Hermes] Failed to save conversation:', error);
      new Notice(`Failed to save conversation: ${message}`);
      return null;
    }
  }

  /**
   * Update an existing conversation file.
   */
  public async updateConversation(filePath: string, messages: ChatMessage[], title?: string, allowedTools: null | string[] = null): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      console.warn(`[Hermes] updateConversation: file not found or not a TFile: ${filePath}`);
      return false;
    }

    try {
      const conversationTitle = title || 'Conversation';
      const content = this.messagesToMarkdown(messages, conversationTitle, allowedTools);
      await this.vault.modify(file, content);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Hermes] Failed to update conversation:', error);
      new Notice(`Failed to update conversation: ${message}`);
      return false;
    }
  }

  /**
   * Update an existing note in the vault.
   */
  public async updateNote(filePath: string, content: string): Promise<boolean> {
    if (!this.isPathSafe(filePath)) { return false; }

    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) { return false; }

    try {
      await this.vault.modify(file, content);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a unique file path for a conversation.
   */
  private generateFilePath(title: string, timestamp: number): string {
    const folder = this.getSaveFolder();
    const safeTitle = this.sanitizeFilename(title) || 'conversation';
    const dateStr = new Date(timestamp).toISOString().split('T')[0] ?? '';
    const yearMonth = dateStr.slice(0, 7); // YYYY-MM

    // Support folder organization modes
    const orgMode = this.plugin.settings.conversationOrganization ?? 'flat';
    const validModes = ['flat', 'by-date', 'by-project'] as const;
    const validatedMode = validModes.includes(orgMode) ? orgMode : 'flat';

    if (validatedMode === 'by-date') {
      return `${folder}/${yearMonth}/${safeTitle}-${dateStr}-${timestamp}.md`;
    }

    return `${folder}/${safeTitle}-${dateStr}-${timestamp}.md`;
  }

  /**
   * Get the configured save folder path.
   */
  private getSaveFolder(): string {
    return this.plugin.settings.chatSaveFolder || 'hermes';
  }

  /**
   * Validate that a path is safe (within vault, no traversal).
   * Rejects absolute paths, parent-directory traversal, null bytes, control
   * characters, and Windows drive-letter paths.
   */
  private isPathSafe(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    if (normalized.startsWith('..') || normalized.startsWith('/') || normalized.includes('../')) {
      return false;
    }
    if (/[\x00-\x1f]/.test(normalized)) {
      return false;
    }
    if (/^[a-zA-Z]:[\\\/]/.test(normalized)) {
      return false;
    }
    return true;
  }

  /**
   * Parse markdown content back into messages.
   */
  private markdownToMessages(content: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const sections = content.split(/\n---\n/);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) { continue; }

      // Skip frontmatter
      if (trimmed.startsWith('---')) { continue; }

      // Parse header: ## **Role** — time
      const headerMatch = MESSAGE_HEADER_REGEX.exec(trimmed);
      if (!headerMatch) { continue; }

      const roleText = headerMatch[1]?.toLowerCase() ?? '';
      const role = roleText === 'you' ? 'user' : roleText === 'hermes' ? 'assistant' : 'system';

      // Extract message id if present
      const idMatch = /^id:\s*([a-f0-9\-]+)\n\n/m.exec(trimmed);
      const messageId = idMatch?.[1] ?? generateMessageId();

      const contentText = trimmed.slice(headerMatch[0].length + (idMatch?.[0]?.length ?? 0));

      messages.push({
        content: contentText.trim(),
        id: messageId,
        role,
        timestamp: Date.now()
      });
    }

    return messages;
  }

  /**
   * Convert messages to markdown content with frontmatter.
   */
  private messagesToMarkdown(messages: ChatMessage[], title: string, allowedTools: null | string[]): string {
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
      ...(allowedTools ? [`allowedTools: ${JSON.stringify(allowedTools)}`] : []),
      'type: hermes-conversation',
      '---',
      ''
    ].join('\n');

    const body = messages.map((msg) => {
      const time = new Date(msg.timestamp).toLocaleString();
      const roleLabel = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**Hermes**' : '**System**';
      return `## ${roleLabel} — ${time}\n\nid: ${msg.id}\n\n${msg.content}\n`;
    }).join('\n---\n\n');

    return `${frontmatter}\n${body}`;
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
}
