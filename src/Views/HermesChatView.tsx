import type { ReactElement } from 'react';

import {
  ItemView,
  MarkdownView,
  Notice,
  type WorkspaceLeaf
} from 'obsidian';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { createRoot } from 'react-dom/client';

import type { AcpSessionUpdate, PromptContextItem } from '../AcpClient.ts';
import type { Plugin } from '../Plugin.ts';
import type { PluginSettings } from '../PluginSettings.ts';
import { getSlashCommands, getToolSlashCommands, parseSlashCommand } from '../SlashCommands.ts';

export const HERMES_CHAT_VIEW_TYPE = 'hermes-chat-view';

export interface ChatMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
  timestamp: number;
}

// Re-export ContextItem shape from AcpClient for UI use
type ContextItem = PromptContextItem;

interface AutocompleteSuggestion {
  id: string;
  text: string;
  type: 'folder' | 'note';
}

interface HermesChatViewComponentProps {
  view: HermesChatView;
}

export class HermesChatView extends ItemView {
  private root: null | ReturnType<typeof createRoot> = null;
  private unsubscribeUpdate: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly pluginInstance: Plugin) {
    super(leaf);
  }

  public override getDisplayText(): string {
    return 'Hermes Chat';
  }

  public getPlugin(): Plugin {
    return this.pluginInstance;
  }

  public getSettings(): PluginSettings {
    return this.pluginInstance.settings;
  }

  public override getViewType(): string {
    return HERMES_CHAT_VIEW_TYPE;
  }

  public override async onClose(): Promise<void> {
    if (this.unsubscribeUpdate) {
      this.unsubscribeUpdate();
      this.unsubscribeUpdate = null;
    }
    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  public override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.root = createRoot(this.contentEl);
    this.root.render(<HermesChatViewComponent view={this} />);
  }

  public async sendPrompt(text: string, contextItems: PromptContextItem[] = []): Promise<void> {
    const client = this.pluginInstance.acpClient;
    if (!client.isReady()) {
      await client.connect();
    }
    await client.sendPrompt(text, contextItems);
  }

  public async cancelPrompt(): Promise<void> {
    await this.pluginInstance.acpClient.cancel();
  }

  public subscribeToUpdates(callback: (update: AcpSessionUpdate) => void): void {
    this.unsubscribeUpdate = this.pluginInstance.acpClient.onUpdate(callback);
  }

  public subscribeToErrors(callback: (error: string) => void): void {
    this.unsubscribeError = this.pluginInstance.acpClient.onError(callback);
  }

  public clearConversation(onClear?: () => void): void {
    // ACP sessions maintain their own history; just clear local state
    if (onClear) {
      onClear();
    }
  }
}

function HermesChatViewComponent({ view }: HermesChatViewComponentProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const lastSendTimeRef = useRef<number>(0);
  const RATE_LIMIT_MS = 2000; // 2 second cooldown between messages
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteSelectionIndex, setAutocompleteSelectionIndex] = useState(0);

  const [slashSuggestions, setSlashSuggestions] = useState<{ description: string; name: string }[]>([]);
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const [toolCommandsLoaded, setToolCommandsLoaded] = useState(false);

  const [conversationFilePath, setConversationFilePath] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConversationListOpen, setIsConversationListOpen] = useState(false);
  const [conversations, setConversations] = useState<{ filePath: string; title: string }[]>([]);

  const plugin = view.getPlugin();
  const settings = view.getSettings();
  const streamingMessageIdRef = useRef<number | null>(null);

  // Subscribe to ACP session updates for streaming
  useEffect(() => {
    view.subscribeToUpdates((update: AcpSessionUpdate) => {
      if (update.type === 'message' && update.content) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.timestamp === streamingMessageIdRef.current) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: last.content + update.content
            };
            return updated;
          }
          return prev;
        });
      } else if (update.type === 'stop') {
        setIsTyping(false);
        streamingMessageIdRef.current = null;
        // Save conversation after response completes
        setMessages((currentMessages) => {
          void saveConversation(currentMessages);
          return currentMessages;
        });
      } else if (update.type === 'tool_start' || update.type === 'tool_progress') {
        // Optionally show tool call status in UI
        // For now, silently ignore tool events
      }
    });

    view.subscribeToErrors((err: string) => {
      setError(err);
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    });

    return () => {
      // Subscriptions are cleaned up by the view's onClose
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const loadConversationList = useCallback(async (): Promise<void> => {
    try {
      const list = await plugin.vaultManager.listConversations();
      setConversations(list.map((c) => ({ filePath: c.filePath, title: c.metadata.title })));
    } catch {
      setConversations([]);
    }
  }, [plugin]);

  const handleLoadConversation = useCallback(async (filePath: string): Promise<void> => {
    try {
      const loaded = await plugin.vaultManager.loadConversation(filePath);
      if (loaded && loaded.messages.length > 0) {
        setMessages(loaded.messages);
        setConversationFilePath(filePath);
        setConversationTitle(loaded.title);
        view.clearConversation();
      }
    } catch {
      // Silently ignore load errors
    } finally {
      setIsConversationListOpen(false);
    }
  }, [plugin, view]);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastPromptRef = useRef<string>('');
  const lastContextItemsRef = useRef<ContextItem[]>([]);

  const handleNewChat = useCallback((): void => {
    setMessages([]);
    setError(null);
    setConversationFilePath(null);
    setConversationTitle('');
    setContextItems([]);
    view.clearConversation();
  }, [view]);

  const saveConversation = useCallback(async (currentMessages: ChatMessage[], currentTitle?: string): Promise<void> => {
    if (currentMessages.length === 0) return;

    setIsSaving(true);
    try {
      const title = currentTitle || conversationTitle || currentMessages[0]?.content.slice(0, 50) || 'Untitled';
      if (!conversationFilePath) {
        const filePath = await plugin.vaultManager.saveConversation(currentMessages, title);
        setConversationFilePath(filePath);
        setConversationTitle(title);
      } else {
        await plugin.vaultManager.updateConversation(conversationFilePath, currentMessages, title);
      }
    } catch {
      // Silently ignore save errors to not disrupt chat flow
    } finally {
      setIsSaving(false);
    }
  }, [conversationFilePath, conversationTitle, plugin]);

  const handleRetry = useCallback(async (): Promise<void> => {
    if (!lastPromptRef.current || isTyping) return;
    setError(null);
    setIsTyping(true);

    const streamingMessageId = Date.now();
    streamingMessageIdRef.current = streamingMessageId;
    const assistantPlaceholder: ChatMessage = {
      content: '',
      role: 'assistant',
      timestamp: streamingMessageId
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      await view.sendPrompt(lastPromptRef.current, lastContextItemsRef.current);
    } catch (err) {
      console.error('Retry failed:', err);
      setError(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    }
  }, [isTyping, view]);

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || isTyping) return;

    // Rate limiting
    const now = Date.now();
    const elapsed = now - lastSendTimeRef.current;
    if (elapsed < RATE_LIMIT_MS) {
      const remaining = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      setRateLimitSeconds(remaining);
      window.setTimeout(() => setRateLimitSeconds(0), RATE_LIMIT_MS - elapsed);
      return;
    }
    lastSendTimeRef.current = now;
    setRateLimitSeconds(0);

    // Check for slash commands
    const slashCmd = parseSlashCommand(trimmed);
    if (slashCmd) {
      setInput('');
      setIsSlashOpen(false);

      const userMessage: ChatMessage = {
        content: trimmed,
        role: 'user',
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, userMessage]);

      if (slashCmd.command.name === 'clear') {
        setMessages([]);
        setContextItems([]);
        view.clearConversation();
        return;
      }

      setIsTyping(true);
      try {
        const result = await slashCmd.command.execute(plugin, slashCmd.args);
        if (result) {
          const systemMessage: ChatMessage = {
            content: result,
            role: 'system',
            timestamp: Date.now()
          };
          setMessages((prev) => [...prev, systemMessage]);
        }
      } catch (err) {
        console.error(`Slash command /${slashCmd.command.name} failed:`, err);
        const errorMessage: ChatMessage = {
          content: `Error executing /${slashCmd.command.name}: ${err instanceof Error ? err.message : String(err)}`,
          role: 'system',
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsTyping(false);
      }
      return;
    }

    const userMessage: ChatMessage = {
      content: trimmed,
      role: 'user',
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsTyping(true);
    lastPromptRef.current = trimmed;
    lastContextItemsRef.current = [...contextItems];

    // Create a placeholder assistant message for streaming
    const streamingMessageId = Date.now();
    streamingMessageIdRef.current = streamingMessageId;
    const assistantPlaceholder: ChatMessage = {
      content: '',
      role: 'assistant',
      timestamp: streamingMessageId
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      await view.sendPrompt(trimmed, contextItems);
    } catch (err) {
      console.error('Send failed:', err);
      setError(`Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    }
  }, [input, isTyping, view, plugin, contextItems]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isSlashOpen && slashSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectionIndex((prev) =>
          prev < slashSuggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectionIndex((prev) =>
          prev > 0 ? prev - 1 : slashSuggestions.length - 1
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = slashSuggestions[slashSelectionIndex];
        if (selected) {
          setInput(`/${selected.name} `);
          setIsSlashOpen(false);
          setSlashSuggestions([]);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }
        return;
      }
      if (e.key === 'Escape') {
        setIsSlashOpen(false);
        return;
      }
    }

    if (isAutocompleteOpen && autocompleteSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteSelectionIndex((prev) =>
          prev < autocompleteSuggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteSelectionIndex((prev) =>
          prev > 0 ? prev - 1 : autocompleteSuggestions.length - 1
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = autocompleteSuggestions[autocompleteSelectionIndex];
        if (selected) {
          insertAutocomplete(selected.text);
        }
        return;
      }
      if (e.key === 'Escape') {
        setIsAutocompleteOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [isSlashOpen, slashSuggestions, slashSelectionIndex, isAutocompleteOpen, autocompleteSuggestions, autocompleteSelectionIndex, handleSend]);

  const insertAutocomplete = useCallback((text: string): void => {
    const value = input;
    const lastOpen = Math.max(value.lastIndexOf('[['), value.lastIndexOf('{'));
    if (lastOpen < 0) return;

    const isWikiLink = value[lastOpen] === '[';
    const queryStart = lastOpen + (isWikiLink ? 2 : 1);
    const prefix = value.substring(0, queryStart);
    const suffix = value.substring(textareaRef.current?.selectionStart ?? value.length);
    const closingBracket = isWikiLink ? ']]' : '}';
    const newText = prefix + text + closingBracket + suffix;

    setInput(newText);
    setIsAutocompleteOpen(false);
    setAutocompleteQuery('');
    setAutocompleteSuggestions([]);
    setAutocompleteSelectionIndex(0);

    const cursorPos = prefix.length + text.length + closingBracket.length;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  }, [input]);

  const handleContextClick = useCallback((): void => {
    const activeFile = plugin.app.workspace.getActiveFile();
    let selectedText = '';

    const allViews = plugin.app.workspace.getLeavesOfType('markdown');
    for (const leaf of allViews) {
      if (leaf.view instanceof MarkdownView) {
        selectedText = leaf.view.editor.getSelection();
        break;
      }
    }

    const autoAddEnabled = settings.contextEntireNote;

    if (selectedText.length > 0) {
      const isDuplicate = contextItems.some((item) =>
        item.type === 'selection' && item.text === selectedText
      );
      if (isDuplicate) return;

      setContextItems((prev) => [...prev, {
        id: `selection-${Date.now()}`,
        text: selectedText,
        type: 'selection'
      }]);
    } else if (activeFile && !autoAddEnabled) {
      const isDuplicate = contextItems.some((item) =>
        item.type === 'note' && item.id === `note-${activeFile.path}`
      );
      if (isDuplicate) return;

      setContextItems((prev) => [...prev, {
        id: `note-${activeFile.path}`,
        text: activeFile.basename,
        type: 'note'
      }]);
    }
  }, [plugin, settings, contextItems]);

  const removeContextItem = useCallback((id: string): void => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleAttachFiles = useCallback(async (files: FileList): Promise<void> => {
    const activeFile = plugin.app.workspace.getActiveFile();
    const targetFolder = activeFile?.parent?.path ?? '';
    const copied: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const fileName = file.name;
        const targetPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;

        // Check if file already exists
        const existing = plugin.app.vault.getAbstractFileByPath(targetPath);
        if (existing) {
          continue; // Skip duplicates silently
        }

        await plugin.app.vault.createBinary(targetPath, arrayBuffer);
        copied.push(fileName);
      } catch {
        // Silently ignore individual file errors
      }
    }

    if (copied.length > 0) {
      new Notice(`Copied ${copied.length} file(s) to vault`);
    }
  }, [plugin]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-add context when active file changes — use Obsidian event instead of useEffect polling
  useEffect(() => {
    if (!settings.contextEntireNote) {
      return undefined;
    }

    const handleActiveLeafChange = (): void => {
      const currentActiveFile = plugin.app.workspace.getActiveFile();
      if (!currentActiveFile) return;

      setContextItems((prev) => {
        const currentNoteItem = prev.find((item) => item.type === 'note');
        if (currentNoteItem?.id === `note-${currentActiveFile.path}`) {
          return prev;
        }
        return [
          ...prev.filter((item) => item.type !== 'note'),
          {
            id: `note-${currentActiveFile.path}`,
            text: currentActiveFile.basename,
            type: 'note'
          }
        ];
      });
    };

    // Set initial context
    handleActiveLeafChange();

    const eventRef = plugin.app.workspace.on('active-leaf-change', handleActiveLeafChange);
    plugin.registerEvent(eventRef);

    return () => {
      plugin.app.workspace.offref(eventRef);
    };
  }, [plugin, settings.contextEntireNote]);

  // Autocomplete trigger detection
  useEffect(() => {
    if (input.length === 0) return;

    const lastChar = input[input.length - 1];
    const lastTwoChars = input.length > 1 ? input.slice(-2) : '';

    const justOpened = (lastChar === '{' && input[input.length - 2] !== '\\') ||
                       (lastTwoChars === '[[' && input[input.length - 3] !== '\\');

    if (justOpened) {
      setIsAutocompleteOpen(true);
      setAutocompleteQuery('');
      setAutocompleteSelectionIndex(0);
    } else if (isAutocompleteOpen) {
      const lastOpen = Math.max(input.lastIndexOf('[['), input.lastIndexOf('{'));
      if (lastOpen >= 0) {
        const query = input.substring(lastOpen + 2);
        setAutocompleteQuery(query);
        if (query.length > 0) {
          setAutocompleteSelectionIndex(0);
        }
      }
    }
  }, [input, isAutocompleteOpen]);

  // Fetch autocomplete suggestions
  useEffect(() => {
    if (autocompleteQuery.length === 0) {
      setAutocompleteSuggestions([]);
      return;
    }

    const vault = plugin.app.vault;
    const files = vault.getMarkdownFiles();
    const queryLower = autocompleteQuery.toLowerCase();

    const matches = files.filter((file) =>
      file.path.toLowerCase().includes(queryLower) ||
      file.basename.toLowerCase().includes(queryLower)
    );

    const recentFiles = matches
      .map((file) => ({ file, mtime: file.stat.mtime }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);

    const suggestions: AutocompleteSuggestion[] = recentFiles.map(({ file }) => ({
      id: `note-${file.path}`,
      text: file.path,
      type: 'note'
    }));

    if (autocompleteQuery.includes('/')) {
      const folders = new Set<string>();
      for (const file of files) {
        const parts = file.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          const folderPath = parts.slice(0, i).join('/');
          if (folderPath.toLowerCase().includes(queryLower)) {
            folders.add(folderPath);
          }
        }
      }

      const folderSuggestions = Array.from(folders)
        .slice(0, 5 - suggestions.length)
        .map((folder) => ({
          id: `folder-${folder}`,
          text: folder,
          type: 'folder' as const
        }));

      suggestions.push(...folderSuggestions);
    }

    setAutocompleteSuggestions(suggestions.slice(0, 5));
  }, [autocompleteQuery, plugin]);

  // Close autocomplete on bracket close
  useEffect(() => {
    if (input.endsWith(']]') || input.endsWith('}')) {
      setIsAutocompleteOpen(false);
    }
  }, [input]);

  // Slash command detection
  useEffect(() => {
    if (input === '/') {
      setIsSlashOpen(true);
      setSlashSelectionIndex(0);
      // Show built-in commands immediately, then merge with tool commands
      const builtIn = getSlashCommands();
      setSlashSuggestions(builtIn.map((cmd) => ({ description: cmd.description, name: cmd.name })));
      // Async fetch tool commands from Hermes API (only once per session)
      if (!toolCommandsLoaded) {
        void getToolSlashCommands(plugin).then((toolCmds) => {
          if (toolCmds.length > 0) {
            const merged = [...builtIn, ...toolCmds];
            setSlashSuggestions(merged.map((cmd) => ({ description: cmd.description, name: cmd.name })));
          }
          setToolCommandsLoaded(true);
        });
      }
      return;
    }

    if (input.startsWith('/')) {
      const query = input.slice(1).toLowerCase();
      const commands = getSlashCommands();
      const filtered = commands.filter((cmd) =>
        cmd.name.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query)
      );
      setSlashSuggestions(filtered.map((cmd) => ({ description: cmd.description, name: cmd.name })));
      setIsSlashOpen(filtered.length > 0);
    } else {
      setIsSlashOpen(false);
      setSlashSuggestions([]);
    }
  }, [input, plugin, toolCommandsLoaded]);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value;
    setInput(value);

    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  }, []);

  return (
    <div className="hermes-chat-container">
      <ChatHeader
        agentName={settings.chatAgentName || 'Hermes'}
        isSaving={isSaving}
        onNewChat={handleNewChat}
        onOpenSettings={() => plugin.openSettings()}
        onToggleConversationList={() => {
          if (!isConversationListOpen) {
            void loadConversationList();
          }
          setIsConversationListOpen((prev) => !prev);
        }}
      />

      {isConversationListOpen && (
        <div className="hermes-conversation-list">
          <div className="hermes-conversation-list-header">
            <span>Previous Conversations</span>
            <button
              className="hermes-icon-btn"
              onClick={() => setIsConversationListOpen(false)}
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>
          {conversations.length === 0 ? (
            <div className="hermes-conversation-empty">No saved conversations</div>
          ) : (
            <ul>
              {conversations.map((conv) => (
                <li key={conv.filePath}>
                  <button
                    className="hermes-conversation-item"
                    onClick={() => void handleLoadConversation(conv.filePath)}
                    type="button"
                  >
                    {conv.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="hermes-chat-content" ref={chatContainerRef}>
        {messages.length === 0 && !error && (
          <div className="hermes-empty-state">
            Start a conversation with {settings.chatAgentName || 'Hermes'}
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageItem key={`${msg.timestamp}-${msg.role}`} message={msg} view={view} />
        ))}
        {isTyping && <TypingIndicator agentName={settings.chatAgentName || 'Hermes'} />}
        {error && (
          <div className="hermes-error" onClick={handleRetry} role="button" tabIndex={0}>
            <span className="hermes-error-icon">⚠️</span>
            <span className="hermes-error-text">{error}</span>
          </div>
        )}
      </div>

      <ChatInput
        contextItems={contextItems}
        input={input}
        isAutocompleteOpen={isAutocompleteOpen}
        isTyping={isTyping}
        rateLimitSeconds={rateLimitSeconds}
        autocompleteQuery={autocompleteQuery}
        autocompleteSelectionIndex={autocompleteSelectionIndex}
        autocompleteSuggestions={autocompleteSuggestions}
        isSlashOpen={isSlashOpen}
        slashSelectionIndex={slashSelectionIndex}
        slashSuggestions={slashSuggestions}
        onAttachFiles={handleAttachFiles}
        onContextClick={handleContextClick}
        onInputChange={handleTextareaChange}
        onInputKeyDown={handleInputKeyDown}
        onRemoveContextItem={removeContextItem}
        onSend={handleSend}
        onSelectAutocomplete={insertAutocomplete}
        onSelectSlash={(name) => {
          setInput(`/${name} `);
          setIsSlashOpen(false);
          setSlashSuggestions([]);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        textareaRef={textareaRef}
      />
    </div>
  );
}

// --- Sub-components ---

interface ChatHeaderProps {
  agentName: string;
  isSaving: boolean;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onToggleConversationList: () => void;
}

function ChatHeader({ agentName, isSaving, onNewChat, onOpenSettings, onToggleConversationList }: ChatHeaderProps): ReactElement {
  return (
    <div className="hermes-chat-header">
      <div className="hermes-chat-header-left">
        <span className="hermes-chat-agent-name">{agentName}</span>
        {isSaving && <span className="hermes-saving-indicator" title="Saving...">●</span>}
      </div>
      <div className="hermes-chat-header-right">
        <button className="hermes-icon-btn" onClick={onToggleConversationList} title="Previous Conversations" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <button className="hermes-icon-btn" onClick={onNewChat} title="New Chat" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button className="hermes-icon-btn" onClick={onOpenSettings} title="Settings" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface ChatMessageItemProps {
  message: ChatMessage;
  view: HermesChatView;
}

function ChatMessageItem({ message, view }: ChatMessageItemProps): ReactElement {
  return (
    <div className={`hermes-message hermes-${message.role}`}>
      <div className="hermes-message-header">
        <span className="hermes-role">{message.role === 'user' ? 'You' : 'Hermes'}</span>
        <span className="hermes-timestamp">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="hermes-message-content">
        <MarkdownRenderer content={message.content} view={view} />
      </div>
    </div>
  );
}

interface TypingIndicatorProps {
  agentName: string;
}

const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function TypingIndicator({ agentName }: TypingIndicatorProps): ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setFrame((prev) => (prev + 1) % BRAILLE_SPINNER.length);
    }, 80);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="hermes-message hermes-assistant">
      <div className="hermes-message-header">
        <span className="hermes-role">{agentName}</span>
        <span className="hermes-typing">
          <span className="hermes-spinner">{BRAILLE_SPINNER[frame]}</span>
          {' Typing'}
        </span>
      </div>
    </div>
  );
}

interface ChatInputProps {
  contextItems: ContextItem[];
  input: string;
  isAutocompleteOpen: boolean;
  isTyping: boolean;
  rateLimitSeconds: number;
  autocompleteQuery: string;
  autocompleteSelectionIndex: number;
  autocompleteSuggestions: AutocompleteSuggestion[];
  isSlashOpen: boolean;
  slashSelectionIndex: number;
  slashSuggestions: { description: string; name: string }[];
  onAttachFiles: (files: FileList) => void;
  onContextClick: () => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveContextItem: (id: string) => void;
  onSend: () => void;
  onSelectAutocomplete: (text: string) => void;
  onSelectSlash: (name: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function ChatInput({
  contextItems,
  input,
  isAutocompleteOpen,
  isTyping,
  rateLimitSeconds,
  autocompleteSelectionIndex,
  autocompleteSuggestions,
  isSlashOpen,
  slashSelectionIndex,
  slashSuggestions,
  onAttachFiles,
  onContextClick,
  onInputChange,
  onInputKeyDown,
  onRemoveContextItem,
  onSend,
  onSelectAutocomplete,
  onSelectSlash,
  textareaRef
}: ChatInputProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="hermes-input-wrapper">
      {isSlashOpen && slashSuggestions.length > 0 && (
        <div className="hermes-autocomplete hermes-slash-commands">
          <div className="hermes-autocomplete-hint">Commands</div>
          {slashSuggestions.map((suggestion, index) => (
            <div
              className={`hermes-autocomplete-item ${index === slashSelectionIndex ? 'selected' : ''}`}
              key={suggestion.name}
              onClick={() => onSelectSlash(suggestion.name)}
              role="option"
              aria-selected={index === slashSelectionIndex}
            >
              <span className="hermes-autocomplete-icon">⚡</span>
              <span className="hermes-autocomplete-text">
                <strong>/{suggestion.name}</strong>
                <span className="hermes-autocomplete-desc">{suggestion.description}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="hermes-input-container">
        <div className="hermes-context-list">
          {contextItems.map((item) => (
            <div className="hermes-context-chip" key={item.id}>
              <button
                className="hermes-context-remove"
                onClick={() => onRemoveContextItem(item.id)}
                title="Remove from context"
                type="button"
              >
                <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                  <line x1="18" x2="6" y1="6" y2="18" />
                  <line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
              <span className="hermes-context-text">{item.text}</span>
            </div>
          ))}
        </div>
        <textarea
          className="hermes-input"
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          placeholder="Message Hermes..."
          ref={textareaRef}
          rows={1}
          value={input}
        />
        <div className="hermes-input-bottom">
          <div className="hermes-input-left">
            <button
              className="hermes-context-btn"
              onClick={onContextClick}
              title="Add Context"
              type="button"
            >
              <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="4" />
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.9" />
              </svg>
            </button>
          </div>
          <div className="hermes-input-right">
            <input
              accept="*/*"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onAttachFiles(e.target.files);
                }
                e.target.value = '';
              }}
              ref={fileInputRef}
              style={{ display: 'none' }}
              type="file"
            />
            <button
              className="hermes-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              type="button"
            >
              <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            {rateLimitSeconds > 0 && (
              <span className="hermes-rate-limit">{rateLimitSeconds}s</span>
            )}
            <button className="hermes-send-btn" disabled={isTyping || !input.trim() || rateLimitSeconds > 0} onClick={onSend} title="Send" type="button">
              <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                <line x1="22" x2="11" y1="2" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isAutocompleteOpen && autocompleteSuggestions.length > 0 && (
        <div className="hermes-autocomplete hermes-autocomplete-rich">
          <div className="hermes-autocomplete-hint">Type to search files...</div>
          {autocompleteSuggestions.map((suggestion, index) => (
            <div
              className={`hermes-autocomplete-item ${index === autocompleteSelectionIndex ? 'selected' : ''}`}
              key={suggestion.id}
              onClick={() => onSelectAutocomplete(suggestion.text)}
              role="option"
              aria-selected={index === autocompleteSelectionIndex}
            >
              <span className="hermes-autocomplete-icon">
                {suggestion.type === 'folder' ? '📁' : '📄'}
              </span>
              <span className="hermes-autocomplete-text">
                <strong>{suggestion.text}</strong>
                <span className="hermes-autocomplete-desc">{suggestion.type === 'folder' ? 'Folder' : 'Note'}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MarkdownRendererProps {
  content: string;
  view: HermesChatView;
}

function MarkdownRenderer({ content, view }: MarkdownRendererProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = '';

    try {
      const app = view.app as unknown as {
        markdownRenderer?: {
          renderMarkdown(markdown: string, el: HTMLElement, component: unknown): Promise<void>;
        };
      };
      if (app.markdownRenderer?.renderMarkdown) {
        void app.markdownRenderer.renderMarkdown(content, containerRef.current, view);
        return;
      }
    } catch {
      // Fall through to fallback
    }

    containerRef.current.textContent = content;
  }, [content, view]);

  return <div className="hermes-markdown-renderer" ref={containerRef} />;
}
