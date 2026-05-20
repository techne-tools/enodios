import type { ReactElement } from 'react';

import {
  Component,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  type WorkspaceLeaf
} from 'obsidian';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  memo
} from 'react';
import { createRoot } from 'react-dom/client';

import type { ChatSessionUpdate, TokenUsageStats } from '../ChatClient.ts';
import type { PendingPermission, PromptContextItem } from '../AcpClient.ts';
import type { PendingFileChange } from '../FileChangeManager.ts';
import type { Plugin } from '../Plugin.ts';
import { getSlashCommands, parseSlashCommand, setCachedToolCommands } from '../SlashCommands.ts';
import { useStreamBuffer } from './useStreamBuffer.ts';
import { parseBlockReferences, resolveBlockReference } from '../utils/blockReferences.ts';
import { generateMessageId } from '../utils/uuid.ts';

/**
 * Strip ANSI escape codes from a string.
 * Handles color codes, cursor movements, clear lines, and other terminal sequences.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- Stripping ANSI codes requires control character matching
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][0-9;]*[^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\x1b[()[\]{}#~%@\^=\/>!]/g, '') // Single-char escape sequences
    .replace(/\x1b\x1b/g, '');              // Double escapes
}

export const HERMES_CHAT_VIEW_TYPE = 'hermes-chat-view';

export interface ChatMessage {
  id: string;
  content: string;
  role: 'assistant' | 'reasoning' | 'system' | 'tool' | 'user' | 'terminal';
  timestamp: number;
  terminalId?: string;
  toolCallId?: string;
  isExited?: boolean;
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

  constructor(leaf: WorkspaceLeaf, private readonly pluginInstance: Plugin) {
    super(leaf);
  }

  public override getDisplayText(): string {
    return 'Hermes Chat';
  }

  public getPlugin(): Plugin {
    return this.pluginInstance;
  }

  public getSettings() {
    return this.pluginInstance.settings;
  }

  public override getViewType(): string {
    return HERMES_CHAT_VIEW_TYPE;
  }

  public override getIcon(): string {
    return 'message-square';
  }

  public override async onClose(): Promise<void> {
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

  public async sendPrompt(text: string, contextItems: PromptContextItem[] = [], options?: { allowedTools?: string[] | null }): Promise<void> {
    const client = this.pluginInstance.getChatClient();
    if (!client.isReady()) {
      await client.connect();
    }
    await client.sendPrompt(text, contextItems, options);
  }

  public async cancelPrompt(): Promise<void> {
    await this.pluginInstance.getChatClient().cancel();
  }

  public abortTerminal(terminalId: string): void {
    this.pluginInstance.getChatClient().abortTerminal?.(terminalId);
  }

  public subscribeToUpdates(callback: (update: ChatSessionUpdate) => void): () => void {
    return this.pluginInstance.getChatClient().onUpdate(callback);
  }

  public subscribeToErrors(callback: (error: string) => void): () => void {
    return this.pluginInstance.getChatClient().onError(callback);
  }

  public subscribeToAvailableCommands(callback: (commands: Array<{ description: string; name: string }>) => void): () => void {
    return this.pluginInstance.getChatClient().onAvailableCommands(callback);
  }

  public clearConversation(onClear?: () => void): void {
    // Disconnect the client so the next prompt creates a fresh session with no memory
    this.pluginInstance.getChatClient().disconnect();
    if (onClear) {
      onClear();
    }
  }
}

export function HermesChatViewComponent({ view }: HermesChatViewComponentProps): ReactElement {
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

  const [allowedTools, setAllowedTools] = useState<string[] | null>(null);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [availableTools, setAvailableTools] = useState<{id: string, name: string}[]>([
    { id: 'readTextFile', name: 'Read Files' },
    { id: 'writeTextFile', name: 'Write Files' },
    { id: 'createTerminal', name: 'Terminal Commands' }
  ]);
  const isSlashOpenRef = useRef(false);
  const inputRef = useRef('');

  // Keep refs in sync with state for useEffect callbacks
  useEffect(() => {
    isSlashOpenRef.current = isSlashOpen;
  }, [isSlashOpen]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const [conversationFilePath, setConversationFilePath] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isConversationListOpen, setIsConversationListOpen] = useState(false);
  const [conversations, setConversations] = useState<{ filePath: string; title: string }[]>([]);
  const [fileChanges, setFileChanges] = useState<PendingFileChange[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);

  // Conversation search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const plugin = view.getPlugin();
  const settings = view.getSettings();
  const lastChunkTimeRef = useRef<number>(0);
  const typingTimeoutRef = useRef<number | null>(null);

  // Ref to track the latest volatile state for stable callbacks.
  // This prevents memoized child components (like ChatMessageItem) from unnecessarily re-rendering.
  const stateRef = useRef({ isTyping, contextItems, allowedTools });
  useEffect(() => {
    stateRef.current = { isTyping, contextItems, allowedTools };
  }, [isTyping, contextItems, allowedTools]);

  const {
    streamingMessageIdRef,
    reasoningMessageIdRef,
    appendContent,
    appendReasoning,
    flushNow
  } = useStreamBuffer(setMessages, settings.showReasoning, settings.enableTypingSound, settings.enableHapticFeedback);

  const clearTypingTimeout = useCallback((): void => {
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  const resetTypingTimeout = useCallback((): void => {
    clearTypingTimeout();
    typingTimeoutRef.current = window.setTimeout(() => {
      setIsTyping(false);
      streamingMessageIdRef.current = null;

      // We wrap saveConversation in a setTimeout to push the I/O side-effect
      // outside of the synchronous React render cycle, preventing duplicate saves
      // during React Strict Mode or concurrent rendering.
      setMessages((currentMessages) => {
        setTimeout(() => void saveConversation(currentMessages), 0);
        return currentMessages;
      });
    }, 3000);
  }, [clearTypingTimeout]);

  // Subscribe to ACP session updates for streaming
  useEffect(() => {
    const unsubUpdate = view.subscribeToUpdates((update: ChatSessionUpdate) => {
      if (update.type === 'message' && update.content) {
        lastChunkTimeRef.current = Date.now();
        resetTypingTimeout();
        appendContent(update.content);
      } else if (update.type === 'stop') {
        flushNow();
        clearTypingTimeout();
        setIsTyping(false);
        streamingMessageIdRef.current = null;
        reasoningMessageIdRef.current = null;
        // Save conversation after response completes
        setMessages((currentMessages) => {
          setTimeout(() => void saveConversation(currentMessages), 0);
          return currentMessages;
        });
      } else if (update.type === 'reasoning' && update.reasoning) {
        if (settings.showReasoning) {
          appendReasoning(update.reasoning);
        }
      } else if (update.type === 'tool_start' || update.type === 'tool_progress' || update.type === 'tool_complete') {
        flushNow();
        if (settings.showToolUse && update.toolCall) {
          let toolMsg = `🔧 **${update.toolCall.name}** (${update.toolCall.status})`;
          if (update.toolCall.result) {
            toolMsg += `\n\n**Result:**\n\`\`\`text\n${update.toolCall.result}\n\`\`\``;
          }

          const currentCallId = update.toolCall.callId;
          setMessages((prev) => {
            const toolIndex = prev.findIndex(
              (m) => m.role === 'tool' && m.toolCallId === currentCallId
            );
            if (toolIndex >= 0) {
              const updated = [...prev];
              updated[toolIndex] = {
                ...prev[toolIndex]!,
                content: toolMsg
              };
              return updated;
            }
            return [...prev, {
              id: generateMessageId(),
              content: toolMsg,
              role: 'tool',
              timestamp: Date.now(),
              toolCallId: currentCallId
            }];
          });
        }
      } else if (update.type === 'terminal_output' && update.terminal) {
        flushNow();
        setMessages((prev) => {
          const index = prev.findIndex((m) => m.role === 'terminal' && m.terminalId === update.terminal!.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = {
              ...updated[index]!,
              content: updated[index]!.content + update.terminal!.output,
              isExited: (updated[index]!.isExited ?? false) || (update.terminal!.isExited ?? false)
            };
            return updated;
          }
          return [...prev, {
            id: generateMessageId(),
            role: 'terminal',
            content: update.terminal!.output,
            timestamp: Date.now(),
            terminalId: update.terminal!.id,
            isExited: update.terminal!.isExited ?? false
          }];
        });
      } else if (update.type === 'available_commands' && update.availableCommands) {
        // Update cached tool commands from ACP
        const toolCmds = update.availableCommands.map((cmd) => ({
          description: cmd.description,
          execute: async (): Promise<string | null> => {
            // Tool commands are sent as regular prompts; the agent handles them
            return null;
          },
          name: cmd.name
        }));
        setCachedToolCommands(toolCmds);
      }
    });

    const unsubError = view.subscribeToErrors((err: string) => {
      flushNow();
      clearTypingTimeout();
      const cleaned = stripAnsi(err).trim();
      if (!cleaned) return;
      setError(cleaned);
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    });

    const unsubCommands = view.subscribeToAvailableCommands((commands) => {
      const toolCmds = commands.map((cmd) => ({
        description: cmd.description,
        execute: async (): Promise<string | null> => {
          // Tool commands are sent as regular prompts; the agent handles them
          return null;
        },
        name: cmd.name
      }));
      setCachedToolCommands(toolCmds);
      setAvailableTools(_prev => {
        const baseTools = [
          { id: 'readTextFile', name: 'Read Files' },
          { id: 'writeTextFile', name: 'Write Files' },
          { id: 'createTerminal', name: 'Terminal Commands' }
        ];
        const dynamicTools = commands.map((c) => ({ id: c.name, name: c.name }));
        const all = [...baseTools, ...dynamicTools];
        return Array.from(new Map(all.map((item) => [item.id, item])).values());
      });
      // Refresh slash suggestions if the dropdown is currently open
      if (isSlashOpenRef.current) {
        const query = inputRef.current.slice(1).toLowerCase();
        const all = getSlashCommands();
        const filtered = all.filter((cmd) =>
          cmd.name.toLowerCase().includes(query)
          || cmd.description.toLowerCase().includes(query)
        );
        setSlashSuggestions(filtered.map((cmd) => ({ description: cmd.description, name: cmd.name })));
      }
    });

    // Subscribe to pending file changes for approval UI
    const unsubscribeChanges = plugin.fileChangeManager.onChanges((changes) => {
      setFileChanges(changes);
    });

    // Subscribe to pending permission requests for approval UI
    const unsubscribePermissions = plugin.acpClient?.onPermissionsChange((permissions) => {
      setPendingPermissions(permissions);
    });

    // Global Cmd+F shortcut for search
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen((prev) => {
          const next = !prev;
          if (next) {
            setIsConversationListOpen(false);
            setIsSessionSettingsOpen(false);
            setTimeout(() => searchInputRef.current?.focus(), 0);
          } else {
            setSearchQuery('');
            setSearchMatches([]);
          }
          return next;
        });
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      clearTypingTimeout();
      unsubscribeChanges();
      unsubscribePermissions?.();
      unsubUpdate();
      unsubError();
      unsubCommands();
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [view, plugin, clearTypingTimeout, resetTypingTimeout, appendContent, appendReasoning, flushNow, settings.showReasoning, settings.showToolUse]);

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
        setAllowedTools(loaded.allowedTools ?? null);
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
  const isAtBottomRef = useRef(true);
  const lastPromptRef = useRef<string>('');
  const lastContextItemsRef = useRef<ContextItem[]>([]);

  const handleNewChat = useCallback((): void => {
    if (conversationFilePath) {
      const shouldDelete = window.confirm('Do you want to delete the current conversation file? Click Cancel to keep it and just start a new chat.');
      if (shouldDelete) {
        plugin.vaultManager.deleteConversation(conversationFilePath).catch(() => {});
      }
    }
    setMessages([]);
    setError(null);
    setConversationFilePath(null);
    setConversationTitle('');
    setContextItems([]);
    setAllowedTools(null);
    view.clearConversation();
  }, [view, conversationFilePath, plugin]);

  const saveConversation = useCallback(async (currentMessages: ChatMessage[], currentTitle?: string, currentAllowedTools: string[] | null = allowedTools): Promise<void> => {
    if (currentMessages.length === 0) return;

    setIsSaving(true);
    try {
      const title = currentTitle || conversationTitle || currentMessages[0]?.content.slice(0, 50) || 'Untitled';
      if (!conversationFilePath) {
        const filePath = await plugin.vaultManager.saveConversation(currentMessages, title, currentAllowedTools);
        if (filePath) {
          setConversationFilePath(filePath);
          setConversationTitle(title);
        }
      } else {
        const success = await plugin.vaultManager.updateConversation(conversationFilePath, currentMessages, title, currentAllowedTools);
        if (!success) {
          console.warn('[Hermes] updateConversation returned false for', conversationFilePath);
        }
      }
    } catch (err) {
      console.error('[Hermes] saveConversation error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [conversationFilePath, conversationTitle, plugin, allowedTools]);

  const handleEditSubmit = useCallback(async (messageId: string, newText: string): Promise<void> => {
    const current = stateRef.current;

    if (current.isTyping || !newText.trim()) return;

    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === messageId);
      if (index < 0) return prev;

      const truncated = prev.slice(0, index);
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        content: newText,
        role: 'user',
        timestamp: Date.now()
      };

      const streamingMessageId = generateMessageId();
      streamingMessageIdRef.current = streamingMessageId;
      reasoningMessageIdRef.current = null;

      const assistantPlaceholder: ChatMessage = {
        id: streamingMessageId,
        content: '',
        role: 'assistant',
        timestamp: Date.now()
      };

      return [...truncated, userMessage, assistantPlaceholder];
    });

    setIsTyping(true);
    setError(null);
    lastPromptRef.current = newText;
    lastContextItemsRef.current = [...current.contextItems];

    try {
      await view.sendPrompt(newText, current.contextItems, { allowedTools: current.allowedTools });
    } catch (err) {
      setError(`Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
    } finally {
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    }
  }, [view]);

  const handleRetry = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (!lastPromptRef.current || current.isTyping) return;
    setError(null);
    setIsTyping(true);

    const streamingMessageId = generateMessageId();
    streamingMessageIdRef.current = streamingMessageId;
    reasoningMessageIdRef.current = null;
    const assistantPlaceholder: ChatMessage = {
      id: streamingMessageId,
      content: '',
      role: 'assistant',
      timestamp: Date.now()
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      await view.sendPrompt(lastPromptRef.current, lastContextItemsRef.current, { allowedTools: current.allowedTools });
    } catch (err) {
      setError(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    }
  }, [view]);

  const handleSend = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const trimmed = inputRef.current.trim();
    if (!trimmed || current.isTyping) return;

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
        id: generateMessageId(),
        content: trimmed,
        role: 'user',
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, userMessage]);

      if (slashCmd.command.name === 'clear') {
          handleNewChat();
        return;
      }

      setIsTyping(true);
      try {
        const result = await slashCmd.command.execute(plugin, slashCmd.args);
        if (result) {
          const systemMessage: ChatMessage = {
            id: generateMessageId(),
            content: result,
            role: 'system',
            timestamp: Date.now()
          };
          setMessages((prev) => [...prev, systemMessage]);
        } else {
          // Tool commands return null — forward to agent as a prompt
          lastPromptRef.current = trimmed;
          lastContextItemsRef.current = [...current.contextItems];

          const streamingMessageId = generateMessageId();
          streamingMessageIdRef.current = streamingMessageId;
          reasoningMessageIdRef.current = null;
          const assistantPlaceholder: ChatMessage = {
            id: streamingMessageId,
            content: '',
            role: 'assistant',
            timestamp: Date.now()
          };
          setMessages((prev) => [...prev, assistantPlaceholder]);

          try {
            await view.sendPrompt(trimmed, current.contextItems, { allowedTools: current.allowedTools });
          } catch (err) {
            setError(`Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
          }
        }
      } catch (err) {
        const errorMessage: ChatMessage = {
          id: generateMessageId(),
          content: `Error executing /${slashCmd.command.name}: ${err instanceof Error ? err.message : String(err)}`,
          role: 'system',
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsTyping(false);
        streamingMessageIdRef.current = null;
      }
      return;
    }

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      content: trimmed,
      role: 'user',
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setError(null);
    setIsTyping(true);
    lastPromptRef.current = trimmed;
    lastContextItemsRef.current = [...current.contextItems];

    // Create a placeholder assistant message for streaming
    const streamingMessageId = generateMessageId();
    streamingMessageIdRef.current = streamingMessageId;
    reasoningMessageIdRef.current = null;
    const assistantPlaceholder: ChatMessage = {
      id: streamingMessageId,
      content: '',
      role: 'assistant',
      timestamp: Date.now()
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    try {
      await view.sendPrompt(trimmed, current.contextItems, { allowedTools: current.allowedTools });
    } catch (err) {
      setError(`Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
    } finally {
      setIsTyping(false);
      streamingMessageIdRef.current = null;
    }
  }, [view, plugin, handleNewChat]);

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

  const handleContextClick = useCallback(async (): Promise<void> => {
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
      // Check if selection is a block reference like [[Note#Heading]]
      const blockRefMatch = selectedText.match(/^\[\[(.+?)(?:#(.+?))?\]\]$/);
      if (blockRefMatch && activeFile) {
        const resolved = await resolveBlockReference(plugin, selectedText);
        if (resolved) {
          const isDuplicate = contextItems.some((item) =>
            item.type === 'note' && item.id === `block-${resolved.path}-${blockRefMatch[2] ?? 'full'}`
          );
          if (isDuplicate) return;

          setContextItems((prev) => [...prev, {
            id: `block-${resolved.path}-${blockRefMatch[2] ?? 'full'}`,
            text: `${activeFile.basename}${blockRefMatch[2] ? ` #${blockRefMatch[2]}` : ''}`,
            type: 'note'
          }]);
          return;
        }
      }

      // Check if selection is within a code block, heading, or list
      if (activeFile) {
        const content = await plugin.app.vault.read(activeFile);
        const blocks = parseBlockReferences(content);
        const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (editor) {
          const from = editor.getCursor('from');
          const to = editor.getCursor('to');
          const startLine = from.line;
          const endLine = to.line;

          // Find the block that contains the selection
          const containingBlock = blocks.find((b) =>
            b.startLine <= startLine && b.endLine >= endLine
          );

          if (containingBlock && containingBlock.type !== 'paragraph') {
            const isDuplicate = contextItems.some((item) =>
              item.type === 'note' && item.id === `block-${activeFile.path}-${containingBlock.startLine}`
            );
            if (isDuplicate) return;

            setContextItems((prev) => [...prev, {
              id: `block-${activeFile.path}-${containingBlock.startLine}`,
              text: `${activeFile.basename} (${containingBlock.type})`,
              type: 'note'
            }]);
            return;
          }
        }
      }

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
      if (file.size > 5 * 1024 * 1024) {
        new Notice(`File "${file.name}" exceeds the 5MB limit and was skipped. Please process large files in another app.`);
        continue;
      }

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
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!container) return;
      // Check if user is scrolled to the bottom. The +5 is a buffer for fractional pixels and borders.
      isAtBottomRef.current = container.scrollHeight - container.clientHeight <= container.scrollTop + 5;
    };

    // The ResizeObserver will fire whenever the content's size changes.
    // This is perfect for catching when async content (like Markdown code blocks) finishes rendering.
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(container);
    container.addEventListener('scroll', handleScroll, { passive: true });

    // When new messages are added, if we were at the bottom, scroll to the new bottom.
    if (isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
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
        const isWikiLink = input[lastOpen] === '[';
        const query = input.substring(lastOpen + (isWikiLink ? 2 : 1));
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
      const commands = getSlashCommands();
      setSlashSuggestions(commands.map((cmd) => ({ description: cmd.description, name: cmd.name })));
      return;
    }

    if (input.startsWith('/')) {
      const query = input.slice(1).toLowerCase();
      const commands = getSlashCommands();
      const filtered = commands.filter((cmd) =>
        cmd.name.toLowerCase().includes(query)
        || cmd.description.toLowerCase().includes(query)
      );
      if (filtered.length > 0) {
        setSlashSuggestions(filtered.map((cmd) => ({ description: cmd.description, name: cmd.name })));
        setIsSlashOpen(true);
      } else {
        // No cached match — still show as a runnable agent command
        const syntheticName = input.slice(1).split(/\s/)[0] ?? '';
        setSlashSuggestions([{
          description: 'Send command to Hermes',
          name: syntheticName
        }]);
        setIsSlashOpen(true);
      }
    } else {
      setIsSlashOpen(false);
      setSlashSuggestions([]);
    }
  }, [input]);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value;
    setInput(value);

    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${target.scrollHeight}px`;
  }, []);

  // Conversation search handlers
  const performSearch = useCallback((query: string): void => {
    if (!query.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      return;
    }
    const lower = query.toLowerCase();
    const indices: number[] = [];
    messages.forEach((msg, idx) => {
      if (msg.content.toLowerCase().includes(lower)) {
        indices.push(idx);
      }
    });
    setSearchMatches(indices);
    setCurrentMatchIndex(indices.length > 0 ? 0 : 0);
  }, [messages]);

  const jumpToMatch = useCallback((direction: 'next' | 'prev'): void => {
    if (searchMatches.length === 0) return;
    const newIndex = direction === 'next'
      ? (currentMatchIndex + 1) % searchMatches.length
      : (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(newIndex);
    const msgIndex = searchMatches[newIndex];
    if (msgIndex !== undefined) {
      const msgId = messages[msgIndex]?.id;
      const el = msgId ? messageRefs.current.get(msgId) : undefined;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('hermes-search-highlight');
        window.setTimeout(() => el.classList.remove('hermes-search-highlight'), 2000);
      }
    }
  }, [searchMatches, currentMatchIndex, messages]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToMatch('next');
    } else if (e.key === 'Escape') {
      setIsSearchOpen(false);
      setSearchQuery('');
      setSearchMatches([]);
    }
  }, [jumpToMatch]);

  return (
    <div className="hermes-chat-container">
      <ChatHeader
        agentName={settings.chatAgentName || 'Hermes'}
        isSaving={isSaving}
        onExportMarkdown={() => {
          try {
            const md = plugin.vaultManager.exportToMarkdown(messages, conversationTitle || 'Hermes Conversation');
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hermes-conversation-${Date.now()}.md`;
            a.click();
            URL.revokeObjectURL(url);
            new Notice('Exported conversation as Markdown');
          } catch {
            new Notice('Failed to export conversation as Markdown');
          }
        }}
        onExportHtml={async () => {
          try {
            const html = await plugin.vaultManager.exportToHtml(messages, conversationTitle || 'Hermes Conversation');
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hermes-conversation-${Date.now()}.html`;
            a.click();
            URL.revokeObjectURL(url);
            new Notice('Exported conversation as HTML');
          } catch {
            new Notice('Failed to export conversation as HTML');
          }
        }}
        onExportJson={() => {
          try {
            const json = plugin.vaultManager.exportToJson(messages, conversationTitle || 'Hermes Conversation');
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hermes-conversation-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            new Notice('Exported conversation as JSON');
          } catch {
            new Notice('Failed to export conversation as JSON');
          }
        }}
        onNewChat={handleNewChat}
        onOpenSettings={() => plugin.openSettings()}
        onToggleConversationList={() => {
          if (!isConversationListOpen) {
            void loadConversationList();
          }
          setIsSessionSettingsOpen(false);
          setIsConversationListOpen((prev) => !prev);
        }}
        onToggleSearch={() => {
          setIsSearchOpen((prev) => !prev);
          setIsConversationListOpen(false);
          setIsSessionSettingsOpen(false);
          if (!isSearchOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }
        }}
        onToggleSessionSettings={() => {
          setIsConversationListOpen(false);
          setIsSessionSettingsOpen((prev) => !prev);
        }}
      />

    {isSessionSettingsOpen && (
      <SessionSettingsPanel
        allowedTools={allowedTools}
        availableTools={availableTools}
        onClose={() => setIsSessionSettingsOpen(false)}
        onToolsChange={(tools) => {
          setAllowedTools(tools);
          if (conversationFilePath) {
             setMessages((current) => {
                setTimeout(() => void saveConversation(current, conversationTitle, tools), 0);
                return current;
             });
          }
        }}
      />
    )}

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
              {conversations.slice(0, 5).map((conv) => (
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

      {isSearchOpen && (
        <div className="hermes-search-bar">
          <input
            ref={searchInputRef}
            className="hermes-search-input"
            placeholder="Search messages..."
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              performSearch(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {searchMatches.length > 0 && (
            <span className="hermes-search-count">
              {currentMatchIndex + 1} / {searchMatches.length}
            </span>
          )}
          <button
            className="hermes-icon-btn"
            onClick={() => jumpToMatch('prev')}
            title="Previous match"
            type="button"
          >
            ↑
          </button>
          <button
            className="hermes-icon-btn"
            onClick={() => jumpToMatch('next')}
            title="Next match"
            type="button"
          >
            ↓
          </button>
          <button
            className="hermes-icon-btn"
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery('');
              setSearchMatches([]);
            }}
            title="Close search"
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <div className="hermes-chat-content" ref={chatContainerRef}>
        {messages.length === 0 && !error && (
          <OnboardingPanel
            agentName={settings.chatAgentName || 'Hermes'}
            hasSeenOnboarding={settings.hasSeenOnboarding}
            onDismiss={() => {
              // @ts-expect-error - settings are mutable at runtime
              plugin.settings.hasSeenOnboarding = true;
              void plugin.settingsManager.saveToFile();
            }}
          />
        )}
        {messages.map((msg) => {
          // Skip rendering the empty assistant placeholder while the typing indicator is shown;
          // once content streams in, the message will render normally.
          if (isTyping && msg.role === 'assistant' && !msg.content) {
            return null;
          }
          return (
            <div
              key={msg.id}
              ref={(el) => {
                if (el) messageRefs.current.set(msg.id, el);
              }}
            >
              <ChatMessageItem message={msg} onEdit={handleEditSubmit} view={view} />
            </div>
          );
        })}
        {isTyping && <TypingIndicator agentName={settings.chatAgentName || 'Hermes'} />}
        {error && (
          <div className="hermes-error" role="alert">
            <span className="hermes-error-icon">⚠️</span>
            <span className="hermes-error-text">{error || 'An error occurred'}</span>
            <button
              className="hermes-error-dismiss"
              onClick={() => setError(null)}
              title="Dismiss"
              type="button"
            >
              ✕
            </button>
            <button
              className="hermes-error-retry"
              onClick={handleRetry}
              title="Retry"
              type="button"
            >
              Retry
            </button>
          </div>
        )}
        {fileChanges.length > 0 && (
          <PendingChangesPanel
            changes={fileChanges}
            onApprove={(id, contentOverride) => void plugin.fileChangeManager.approveChange(id, contentOverride)}
            onApproveAll={() => void plugin.fileChangeManager.approveAll()}
            onReject={(id) => plugin.fileChangeManager.rejectChange(id)}
            onRejectAll={() => plugin.fileChangeManager.rejectAll()}
            onClearResolved={() => plugin.fileChangeManager.clearResolved()}
          />
        )}
        {pendingPermissions.length > 0 && (
          <PendingPermissionsPanel
            permissions={pendingPermissions}
            onApprove={(permissionId, optionId) => {
              plugin.acpClient?.resolvePermission(permissionId, optionId);
            }}
            onApproveAll={() => {
              plugin.acpClient?.resolveAllPermissions();
            }}
            onReject={(permissionId) => {
              plugin.acpClient?.cancelPermission(permissionId);
            }}
            onRejectAll={() => {
              plugin.acpClient?.cancelAllPermissions();
            }}
          />
        )}
        <TokenUsageFooter visible={settings.showTokenCount} />
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
  onExportHtml: () => void;
  onExportJson: () => void;
  onExportMarkdown: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onToggleConversationList: () => void;
  onToggleSearch: () => void;
  onToggleSessionSettings: () => void;
}

const ChatHeader = memo(function ChatHeader({ agentName, isSaving, onExportHtml, onExportJson, onExportMarkdown, onNewChat, onOpenSettings, onToggleConversationList, onToggleSearch, onToggleSessionSettings }: ChatHeaderProps): ReactElement {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  return (
    <div className="hermes-chat-header">
      <div className="hermes-chat-header-left">
        <span className="hermes-chat-agent-name">{agentName}</span>
        {isSaving && <span className="hermes-saving-indicator" title="Saving...">●</span>}
      </div>
      <div className="hermes-chat-header-right">
        <button className="hermes-icon-btn" onClick={onToggleSearch} title="Search Messages (Cmd+F)" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
        <button className="hermes-icon-btn" onClick={onToggleConversationList} title="Previous Conversations" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <button className="hermes-icon-btn" onClick={onToggleSessionSettings} title="Session Tools" type="button">
          <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
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
        <div style={{ position: 'relative' }} ref={exportMenuRef}>
          <button className="hermes-icon-btn" onClick={() => setShowExportMenu((prev) => !prev)} title="Export" type="button">
            <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </button>
          {showExportMenu && (
            <div className="hermes-export-menu">
              <button className="hermes-export-item" onClick={() => { onExportMarkdown(); setShowExportMenu(false); }} type="button">Export as Markdown</button>
              <button className="hermes-export-item" onClick={() => { onExportHtml(); setShowExportMenu(false); }} type="button">Export as HTML</button>
              <button className="hermes-export-item" onClick={() => { onExportJson(); setShowExportMenu(false); }} type="button">Export as JSON</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

interface SessionSettingsPanelProps {
  allowedTools: string[] | null;
  availableTools: { id: string; name: string }[];
  onToolsChange: (tools: string[] | null) => void;
  onClose: () => void;
}

const SessionSettingsPanel = memo(function SessionSettingsPanel({ allowedTools, availableTools, onToolsChange, onClose }: SessionSettingsPanelProps): ReactElement {
  const isAllAllowed = allowedTools === null;

  const toggleTool = (toolId: string): void => {
    if (isAllAllowed) {
      // If previously using default, start an explicit list excluding the toggled tool
      onToolsChange(availableTools.map((t) => t.id).filter((id) => id !== toolId));
    } else {
      const newTools = allowedTools.includes(toolId)
        ? allowedTools.filter((id) => id !== toolId)
        : [...allowedTools, toolId];
      onToolsChange(newTools);
    }
  };

  return (
    <div className="hermes-session-settings">
      <div className="hermes-session-settings-header">
        <span>Session Tools</span>
        <button className="hermes-icon-btn" onClick={onClose} title="Close" type="button">✕</button>
      </div>
      <div className="hermes-session-settings-content">
        <p className="hermes-session-settings-desc">Select which tools the agent is allowed to use during this specific chat session.</p>
        <div className="hermes-session-settings-actions">
           <button className="hermes-btn-secondary" onClick={() => onToolsChange(null)} title="Remove session-specific restrictions" type="button">Reset Default</button>
           <button className="hermes-btn-secondary" onClick={() => onToolsChange(availableTools.map((t) => t.id))} type="button">Allow All</button>
           <button className="hermes-btn-secondary" onClick={() => onToolsChange([])} type="button">Disable All</button>
        </div>
        {availableTools.map((tool) => (
          <label className="hermes-session-tool-toggle" key={tool.id}>
            <input
              checked={isAllAllowed || allowedTools.includes(tool.id)}
              onChange={() => toggleTool(tool.id)}
              type="checkbox"
            />
            <span>{tool.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
});

interface ChatMessageItemProps {
  message: ChatMessage;
  view: HermesChatView;
  onEdit?: (messageId: string, newContent: string) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({ message, view, onEdit }: ChatMessageItemProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(() => {
      new Notice('Failed to copy to clipboard');
    });
  }, [message.content]);

  const roleLabel = {
    assistant: 'Hermes',
    reasoning: 'Reasoning',
    system: 'System',
    tool: 'Tool',
    user: 'You',
    terminal: 'Terminal Output'
  }[message.role];

  if (message.role === 'terminal') {
    return (
      <div className={`hermes-message hermes-${message.role}`}>
        <div className="hermes-message-header">
          <span className="hermes-role">{roleLabel}</span>
          <span className="hermes-message-meta">
            <button className="hermes-icon-btn hermes-msg-action-btn" onClick={handleCopy} title={isCopied ? 'Copied!' : 'Copy Output'} type="button">
              {isCopied ? (
                <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                  <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <span className="hermes-timestamp">{new Date(message.timestamp).toLocaleTimeString()}</span>
          </span>
        </div>
        <div className="hermes-terminal-content">
          {message.content}
        </div>
        {!message.isExited && (
          <button className="hermes-abort-btn" onClick={() => view.abortTerminal(message.terminalId!)} title="Stop the running command" type="button">
            🛑 Abort
          </button>
        )}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className={`hermes-message hermes-${message.role}`}>
        <div className="hermes-message-header">
          <span className="hermes-role">{roleLabel}</span>
        </div>
        <div className="hermes-message-content">
          <textarea
            className="hermes-edit-input"
            onChange={(e) => setEditValue(e.target.value)}
            rows={Math.max(3, editValue.split('\n').length)}
            value={editValue}
          />
          <div className="hermes-edit-actions">
            <button
              className="hermes-btn-approve"
              onClick={() => { setIsEditing(false); onEdit?.(message.id, editValue); }}
              type="button"
            >
              Save & Submit
            </button>
            <button
              className="hermes-btn-reject"
              onClick={() => { setIsEditing(false); setEditValue(message.content); }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`hermes-message hermes-${message.role}`}>
      <div className="hermes-message-header">
        <span className="hermes-role">{roleLabel}</span>
        <span className="hermes-message-meta">
          <button className="hermes-icon-btn hermes-msg-action-btn" onClick={handleCopy} title={isCopied ? 'Copied!' : 'Copy Message'} type="button">
            {isCopied ? (
              <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          {message.role === 'user' && (
            <button className="hermes-icon-btn hermes-msg-action-btn" onClick={() => setIsEditing(true)} title="Edit Message" type="button">
              <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          <span className="hermes-timestamp">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </span>
      </div>
      <div className="hermes-message-content">
        <MarkdownContent content={message.content} view={view} />
      </div>
    </div>
  );
});

interface TypingIndicatorProps {
  agentName: string;
}

const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const TypingIndicator = memo(function TypingIndicator({ agentName }: TypingIndicatorProps): ReactElement {
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
});

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
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const ChatInput = memo(function ChatInput({
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea whenever input changes (including programmatic insertions like file paths)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input, textareaRef]);

  useEffect(() => {
    if (autocompleteRef.current) {
      const selected = autocompleteRef.current.querySelector('.selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [slashSelectionIndex, autocompleteSelectionIndex]);

  return (
    <div className="hermes-input-wrapper">
      {isSlashOpen && slashSuggestions.length > 0 && (
        <div className="hermes-autocomplete hermes-slash-commands" ref={autocompleteRef}>
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
            <span className="hermes-context-text">
              {item.type === 'image' ? '🖼️ ' : ''}
              {item.type === 'pdf' ? '📄 ' : ''}
              {item.text}
            </span>
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
        <div className="hermes-autocomplete hermes-autocomplete-rich" ref={autocompleteRef}>
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
});

interface MarkdownContentProps {
  content: string;
  view: HermesChatView;
}

const MarkdownContent = memo(function MarkdownContent({ content, view }: MarkdownContentProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    containerRef.current.innerHTML = '';

    const renderChild = new Component();
    renderChild.load();

    try {
      MarkdownRenderer.render(view.app, content, containerRef.current, view.app.vault.getRoot().path, renderChild).then(() => {
        if (!containerRef.current) return;
        const preElements = containerRef.current.querySelectorAll('pre');
        preElements.forEach((pre) => {
          if (pre.parentElement?.classList.contains('hermes-code-block-wrapper')) return;

          const wrapper = document.createElement('div');
          wrapper.className = 'hermes-code-block-wrapper';
          pre.parentNode?.insertBefore(wrapper, pre);
          wrapper.appendChild(pre);

          const copyBtn = document.createElement('button');
          copyBtn.className = 'hermes-icon-btn hermes-code-copy-btn';
          copyBtn.title = 'Copy code';
          copyBtn.innerHTML = '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><rect height="13" rx="2" ry="2" width="13" x="9" y="9" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';

          copyBtn.addEventListener('click', async () => {
            const codeEl = pre.querySelector('code');
            if (codeEl) {
              try {
                await navigator.clipboard.writeText(codeEl.innerText);
                copyBtn.innerHTML = '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><polyline points="20 6 9 17 4 12" /></svg>';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                  copyBtn.innerHTML = '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><rect height="13" rx="2" ry="2" width="13" x="9" y="9" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';
                  copyBtn.classList.remove('copied');
                }, 2000);
              } catch (err) {
                // Ignore copy errors
              }
            }
          });
          wrapper.appendChild(copyBtn);
        });
      }).catch(() => {
        // Ignore render errors
      });
    } catch {
      containerRef.current.textContent = content;
    }

    return () => {
      renderChild.unload();
    };
  }, [content, view]);

  return <div className="hermes-markdown-renderer" ref={containerRef} />;
});

// --- Diff / Pending Changes Components ---

interface DiffLine {
  line: string;
  type: 'added' | 'removed' | 'unchanged';
}

function computeDiffLines(original: string, updated: string): DiffLine[] {
  const origLines = original.split('\n');
  const newLines = updated.split('\n');
  const result: DiffLine[] = [];
  let oi = 0;
  let ni = 0;

  while (oi < origLines.length || ni < newLines.length) {
    if (oi >= origLines.length) {
      result.push({ line: newLines[ni]!, type: 'added' });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ line: origLines[oi]!, type: 'removed' });
      oi++;
    } else if (origLines[oi] === newLines[ni]) {
      result.push({ line: origLines[oi]!, type: 'unchanged' });
      oi++;
      ni++;
    } else {
      // Simple heuristic: if next original matches next new, this new is an addition
      if (ni + 1 < newLines.length && origLines[oi] === newLines[ni + 1]) {
        result.push({ line: newLines[ni]!, type: 'added' });
        ni++;
      } else if (oi + 1 < origLines.length && origLines[oi + 1] === newLines[ni]) {
        result.push({ line: origLines[oi]!, type: 'removed' });
        oi++;
      } else {
        // Treat as replacement: remove old, add new
        result.push({ line: origLines[oi]!, type: 'removed' });
        result.push({ line: newLines[ni]!, type: 'added' });
        oi++;
        ni++;
      }
    }
  }

  return result;
}

interface PendingChangesPanelProps {
  changes: PendingFileChange[];
  onApprove: (changeId: string, contentOverride?: string) => void;
  onApproveAll: () => void;
  onClearResolved: () => void;
  onReject: (changeId: string) => void;
  onRejectAll: () => void;
}

const PendingChangesPanel = memo(function PendingChangesPanel({ changes, onApprove, onApproveAll, onReject, onRejectAll, onClearResolved }: PendingChangesPanelProps): ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<Map<string, Set<number>>>(new Map());

  const pendingCount = changes.filter((c) => c.status === 'pending').length;
  const resolvedCount = changes.length - pendingCount;

  const toggleLine = (changeId: string, lineIndex: number): void => {
    setSelectedLines((prev) => {
      const next = new Map(prev);
      const current = next.get(changeId) ?? new Set();
      const updated = new Set(current);
      if (updated.has(lineIndex)) {
        updated.delete(lineIndex);
      } else {
        updated.add(lineIndex);
      }
      next.set(changeId, updated);
      return next;
    });
  };

  const getPartialContent = (change: PendingFileChange, selected: Set<number>): string => {
    const diffLines = change.diffSnapshot ?? computeDiffLines(change.originalContent, change.newContent ?? '');
    const result: string[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const dl = diffLines[i]!;
      const isSelected = selected.has(i);
      if (dl.type === 'unchanged') {
        result.push(dl.line);
      } else if (dl.type === 'added' && isSelected) {
        result.push(dl.line);
      } else if (dl.type === 'removed' && !isSelected) {
        result.push(dl.line);
      }
    }
    return result.join('\n');
  };

  return (
    <div className="hermes-pending-changes">
      <div className="hermes-pending-changes-header">
        <span>File Changes ({pendingCount} pending{resolvedCount > 0 ? `, ${resolvedCount} resolved` : ''})</span>
        <div className="hermes-pending-changes-actions">
          {pendingCount > 1 && (
            <>
              <button className="hermes-btn-approve" onClick={onApproveAll} type="button">Approve All</button>
              <button className="hermes-btn-reject" onClick={onRejectAll} type="button">Reject All</button>
            </>
          )}
          {resolvedCount > 0 && (
            <button className="hermes-icon-btn" onClick={onClearResolved} title="Clear resolved" type="button">
              ✕
            </button>
          )}
        </div>
      </div>
      {changes.map((change) => {
        const isExpanded = expandedId === change.id;
        const diffLines = change.diffSnapshot ?? computeDiffLines(change.originalContent, change.newContent ?? '');
        const selected = selectedLines.get(change.id) ?? new Set();
        const hasSelections = selected.size > 0;
        return (
          <div className={`hermes-pending-change hermes-change-${change.status}`} key={change.id}>
            <div className="hermes-pending-change-summary" onClick={() => setExpandedId(isExpanded ? null : change.id)} role="button" tabIndex={0}>
              <span className="hermes-pending-change-path">{change.path}</span>
              <div className="hermes-pending-change-badges">
                {change.status !== 'pending' && (
                  <span className={`hermes-pending-change-badge hermes-badge-${change.status}`}>{change.status}</span>
                )}
                <span className={`hermes-pending-change-badge hermes-badge-${change.action}`}>{change.action}</span>
              </div>
            </div>
            {isExpanded && (
              <div className="hermes-pending-change-diff">
                <div className="hermes-diff-view">
                  {diffLines.map((dl, idx) => {
                    const isSelected = selected.has(idx);
                    const isToggleable = dl.type === 'added' || dl.type === 'removed';
                    return (
                      <div className={`hermes-diff-line hermes-diff-${dl.type} ${isSelected ? 'hermes-diff-selected' : ''}`} key={idx}>
                        {isToggleable && change.status === 'pending' && (
                          <input
                            checked={isSelected}
                            className="hermes-diff-checkbox"
                            onChange={() => toggleLine(change.id, idx)}
                            title={isSelected ? 'Include this change' : 'Exclude this change'}
                            type="checkbox"
                          />
                        )}
                        <span className="hermes-diff-marker">{dl.type === 'added' ? '+' : dl.type === 'removed' ? '-' : ' '}</span>
                        <span className="hermes-diff-text">{dl.line}</span>
                      </div>
                    );
                  })}
                </div>
                {change.status === 'pending' && (
                  <div className="hermes-pending-change-actions">
                    <button className="hermes-btn-approve" onClick={() => {
                      if (hasSelections) {
                        const partial = getPartialContent(change, selected);
                        onApprove(change.id, partial);
                      } else {
                        onApprove(change.id);
                      }
                    }} type="button">
                      {hasSelections ? 'Approve Selected' : 'Approve All'}
                    </button>
                    <button className="hermes-btn-reject" onClick={() => onReject(change.id)} type="button">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// --- Permission Request Components ---

interface PendingPermissionsPanelProps {
  permissions: PendingPermission[];
  onApprove: (permissionId: string, optionId: string) => void;
  onApproveAll: () => void;
  onReject: (permissionId: string) => void;
  onRejectAll: () => void;
}

const PendingPermissionsPanel = memo(function PendingPermissionsPanel({ permissions, onApprove, onApproveAll, onReject, onRejectAll }: PendingPermissionsPanelProps): ReactElement {
  return (
    <div className="hermes-pending-permissions">
      <div className="hermes-pending-permissions-header">
        <span>Permission Requests ({permissions.length})</span>
        {permissions.length > 1 && (
          <div className="hermes-pending-permissions-actions">
            <button className="hermes-btn-approve" onClick={onApproveAll} type="button">Approve All</button>
            <button className="hermes-btn-reject" onClick={onRejectAll} type="button">Reject All</button>
          </div>
        )}
      </div>
      {permissions.map((permission) => (
        <div className="hermes-pending-permission" key={permission.id}>
          <div className="hermes-pending-permission-summary">
            <span className="hermes-pending-permission-desc">
              A tool is requesting permission to run
            </span>
          </div>
          <div className="hermes-pending-permission-options">
            {permission.params.options.map((option) => (
              <button
                className={`hermes-permission-option hermes-permission-option--${option.kind}`}
                key={option.optionId}
                onClick={() => onApprove(permission.id, option.optionId)}
                type="button"
              >
                {option.name}
              </button>
            ))}
            <button
              className="hermes-permission-option hermes-permission-option--reject"
              onClick={() => onReject(permission.id)}
              type="button"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
});

// --- Token Usage Footer ---

interface TokenUsageFooterProps {
  visible: boolean;
}

const TokenUsageFooter = memo(function TokenUsageFooter({ visible }: TokenUsageFooterProps): ReactElement {
  const [usage, setUsage] = useState<TokenUsageStats>({
    estimatedCost: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Listen for usage_update events from the ACP client
    const handleUsageUpdate = (e: CustomEvent<TokenUsageStats>): void => {
      setUsage(e.detail);
      setIsVisible(true);
    };

    window.addEventListener('hermes-usage-update', handleUsageUpdate as EventListener);
    return () => {
      window.removeEventListener('hermes-usage-update', handleUsageUpdate as EventListener);
    };
  }, []);

  if (!visible || !isVisible) return <></>;

  return (
    <div className="hermes-token-footer">
      <span className="hermes-token-stat" title="Input tokens">
        <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
        {' '}{usage.inputTokens.toLocaleString()} in
      </span>
      <span className="hermes-token-stat" title="Output tokens">
        <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
        {' '}{usage.outputTokens.toLocaleString()} out
      </span>
      <span className="hermes-token-stat" title="Total tokens">
        {usage.totalTokens.toLocaleString()} total
      </span>
      <span className="hermes-token-stat hermes-token-cost" title="Estimated cost (USD)">
        ~${usage.estimatedCost.toFixed(4)}
      </span>
    </div>
  );
});

// --- Onboarding Panel ---

interface OnboardingPanelProps {
  agentName: string;
  hasSeenOnboarding: boolean;
  onDismiss: () => void;
}

const OnboardingPanel = memo(function OnboardingPanel({ agentName, hasSeenOnboarding, onDismiss }: OnboardingPanelProps): ReactElement {
  const [isVisible, setIsVisible] = useState(!hasSeenOnboarding);

  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsVisible(false);
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onDismiss]);

  if (!isVisible) {
    return (
      <div className="hermes-empty-state">
        Start a conversation with {agentName}
      </div>
    );
  }

  return (
    <div className="hermes-onboarding">
      <div className="hermes-onboarding-header">
        <span>👋 Welcome to {agentName}</span>
        <button className="hermes-icon-btn" onClick={() => { setIsVisible(false); onDismiss(); }} title="Dismiss" type="button">✕</button>
      </div>
      <div className="hermes-onboarding-content">
        <p><strong>{agentName}</strong> is your AI assistant inside Obsidian. Here's how to get started:</p>
        <ul>
          <li><strong>💬 Chat:</strong> Type a message and press Enter to send.</li>
          <li><strong>📎 Context:</strong> Click the @ button to add the current note or selection to the conversation.</li>
          <li><strong>⚡ Slash Commands:</strong> Type <code>/</code> to see available commands like <code>/clear</code>, <code>/persona</code>, <code>/search</code>.</li>
          <li><strong>🔧 Tools:</strong> The agent can read files, write files, and run terminal commands (with your approval).</li>
          <li><strong>🔍 Search:</strong> Press <kbd>Cmd+F</kbd> to search through messages.</li>
          <li><strong>⚙️ Settings:</strong> Configure connection mode (ACP/API), personas, and security in the settings tab.</li>
        </ul>
        <p className="hermes-onboarding-security">🔒 <strong>Security Note:</strong> Terminal access is disabled by default. File changes require your explicit approval via the diff viewer.</p>
      </div>
      <button className="hermes-btn-approve" onClick={() => { setIsVisible(false); onDismiss(); }} type="button">
        Got it!
      </button>
    </div>
  );
});
