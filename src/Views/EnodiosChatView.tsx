import type { WorkspaceLeaf } from "obsidian";
import type { ReactElement } from "react";

import { ItemView, MarkdownView, Notice, TFile } from "obsidian";
import { highlight, languages } from "prismjs";
import { memo, useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable import-x/no-unassigned-import */
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
/* eslint-enable import-x/no-unassigned-import */
import { createRoot } from "react-dom/client";

import type { PendingPermission, PromptContextItem } from "../AcpClient.ts";
import type { AuditEntry } from "../AuditLog.ts";
import type {
    AcpConnectionStatus,
    ChatSessionUpdate,
    TokenUsageStats
} from "../ChatClient.ts";
import type { PendingFileChange } from "../FileChangeManager.ts";
import type { Plugin } from "../Plugin.ts";
import type { ChatTemplate } from "../TemplateManager.ts";
import { useAutocomplete } from "./Hooks/useAutocomplete.ts";
import { useSlashCommands } from "./Hooks/useSlashCommands.ts";

import {
    getSlashCommands,
    parseSlashCommand,
    setCachedToolCommands
} from "../SlashCommands.ts";
import {
    parseBlockReferences,
    resolveBlockReference
} from "../utils/blockReferences.ts";
import { generateMessageId } from "../utils/uuid.ts";
import { useStreamBuffer } from "./useStreamBuffer.ts";

import { AuditLogPanel } from "./Components/AuditLogPanel.tsx";
import { ChatHeader } from "./Components/ChatHeader.tsx";
import { MessageList } from "./Components/MessageList.tsx";

/**
 * Helper to safely escape HTML for the diff viewer fallback.
 */
function escapeHtml(str: string): string {
  return str.replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[tag] || tag
  );
}

/**
 * Map file extensions to Prism languages.
 */
function getLanguageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    yaml: "yaml",
    yml: "yaml",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    c: "c",
    cs: "csharp"
  };
  return map[ext] || "markdown";
}

/**
 * Syntax highlight a single line of a diff.
 */
function highlightLine(line: string, path: string): string {
  const lang = getLanguageForPath(path);
  if (languages[lang]) {
    try {
      return highlight(line, languages[lang]!, lang);
    } catch {
      /* ignore */
    }
  }
  return escapeHtml(line);
}

/**
 * Strip ANSI escape codes from a string.
 * Handles color codes, cursor movements, clear lines, and other terminal sequences.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][0-9;]*[^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC sequences
    .replace(/\x1b[()[\]{}#~%@\^=\/>!]/g, "") // Single-char escape sequences
    .replace(/\x1b\x1b/g, ""); // Double escapes
}

export const ENODIOS_CHAT_VIEW_TYPE = "enodios-chat-view";

export interface ChatMessage {
  content: string;
  id: string;
  isBackgrounded?: boolean;
  isCollapsed?: boolean;
  isExited?: boolean;
  isRunning?: boolean;
  role: "assistant" | "reasoning" | "system" | "terminal" | "tool" | "user";
  terminalId?: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: "complete" | "error" | "running";
}

interface AutocompleteSuggestion {
  id: string;
  text: string;
  type: "folder" | "note" | "citation";
}

// Re-export ContextItem shape from AcpClient for UI use
type ContextItem = PromptContextItem;

interface EnodiosChatViewComponentProps {
  view: EnodiosChatView;
}

export class EnodiosChatView extends ItemView {
  private root: null | ReturnType<typeof createRoot> = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly pluginInstance: Plugin
  ) {
    super(leaf);
  }

  public get plugin(): Plugin {
    return this.pluginInstance;
  }

  public abortTerminal(terminalId: string): void {
    this.pluginInstance.getChatClient().abortTerminal?.(terminalId);
  }

  public async cancelPrompt(): Promise<void> {
    await this.pluginInstance.getChatClient().cancel();
  }

  public clearConversation(onClear?: () => void): void {
    // Disconnect the client so the next prompt creates a fresh session with no memory
    this.pluginInstance.getChatClient().disconnect();
    if (onClear) {
      onClear();
    }
  }

  public override getDisplayText(): string {
    return "Enodios Chat";
  }

  public override getIcon(): string {
    return "message-square";
  }

  public getPlugin(): Plugin {
    return this.pluginInstance;
  }

  public getSettings() {
    return this.pluginInstance.settings;
  }

  public override getViewType(): string {
    return ENODIOS_CHAT_VIEW_TYPE;
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
    this.root.render(<EnodiosChatViewComponent view={this} />);
  }

  public async sendPrompt(
    text: string,
    contextItems: PromptContextItem[] = [],
    options?: { allowedTools?: null | string[] }
  ): Promise<void> {
    const client = this.pluginInstance.getChatClient();
    if (!client.isReady()) {
      await client.connect();
    }
    await client.sendPrompt(text, contextItems, options);
  }

  public subscribeToAvailableCommands(
    callback: (commands: { description: string; name: string }[]) => void
  ): () => void {
    return this.pluginInstance.getChatClient().onAvailableCommands(callback);
  }

  public subscribeToConnectionStatus(
    callback: (status: AcpConnectionStatus) => void
  ): () => void {
    const client = this.pluginInstance.getChatClient();
    if (client.onConnectionStatus) {
      return client.onConnectionStatus(callback);
    }
    return () => {};
  }

  public subscribeToErrors(callback: (error: string) => void): () => void {
    return this.pluginInstance.getChatClient().onError(callback);
  }

  public subscribeToUpdates(
    callback: (update: ChatSessionUpdate) => void
  ): () => void {
    return this.pluginInstance.getChatClient().onUpdate(callback);
  }
}

// --- Sub-components ---

interface StarterIconProps {
  icon: string;
  id: string;
}

function StarterIcon({ icon, id }: StarterIconProps): React.JSX.Element {
  const attrs = {
    fill: "none",
    height: "24",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: "2",
    viewBox: "0 0 24 24",
    width: "24",
    className: "svg-icon"
  };

  if (id === "lit-review" || icon === "📚") {
    return (
      <svg {...attrs}>
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    );
  }
  if (id === "writing-coach" || icon === "✍️") {
    return (
      <svg {...attrs}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (id === "code-assistant" || icon === "💻") {
    return (
      <svg {...attrs}>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  if (id === "study-companion" || icon === "🧠") {
    return (
      <svg {...attrs}>
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
    );
  }

  return (
    <svg {...attrs}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

export function EnodiosChatViewComponent({
  view
}: EnodiosChatViewComponentProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<AcpConnectionStatus | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const lastSendTimeRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const RATE_LIMIT_MS = 2000; // 2 second cooldown between messages
  const {
    autocompleteQuery,
    setAutocompleteQuery,
    autocompleteSuggestions,
    setAutocompleteSuggestions,
    isAutocompleteOpen,
    setIsAutocompleteOpen,
    autocompleteSelectionIndex,
    setAutocompleteSelectionIndex,
    cycleSuggestions
  } = useAutocomplete();

  const {
    slashSuggestions,
    isSlashOpen,
    slashSelectionIndex,
    setSlashSelectionIndex,
    activeCommand,
    setActiveCommand,
    handleSlashInput,
    handleSlashKeyDown,
    setIsSlashOpen,
    setSlashSuggestions
  } = useSlashCommands(setInput, textareaRef);

  const [allowedTools, setAllowedTools] = useState<null | string[]>(null);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [availableTools, setAvailableTools] = useState<
    { id: string; name: string }[]
  >([
    { id: "read_file", name: "Read Files" },
    { id: "write_file", name: "Write Files" },
    { id: "terminal", name: "Terminal Commands" },
    { id: "web_search", name: "Web Search" },
    { id: "web_extract", name: "Web Extract" }
  ]);
  const isSlashOpenRef = useRef(false);
  const inputRef = useRef("");

  // Keep refs in sync with state for useEffect callbacks
  useEffect(() => {
    isSlashOpenRef.current = isSlashOpen;
  }, [isSlashOpen]);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Synchronize context items to view instance for slash command access
  useEffect(() => {
    (
      view as unknown as { activeContextItems: typeof contextItems }
    ).activeContextItems = contextItems;
  }, [contextItems, view]);

  const [templates, setTemplates] = useState<ChatTemplate[]>([]);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const loaded = await view.plugin.templateManager.loadTemplates();
        setTemplates(loaded);
      } catch (err) {
        view.plugin.debug.error("Failed to load conversation templates", err);
      }
    };
    void fetchTemplates();
  }, [view.plugin, messages.length]);

  // Synchronize messages to view instance for template saving slash command
  useEffect(() => {
    (view as unknown as { activeMessages: typeof messages }).activeMessages =
      messages;
  }, [messages, view]);

  // Listen for custom event to load template prompts
  useEffect(() => {
    const handleLoadTemplate = (e: Event) => {
      const prompt = (e as CustomEvent).detail;
      setInput(prompt);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    };
    window.addEventListener("enodios-load-template", handleLoadTemplate);
    return () => {
      window.removeEventListener("enodios-load-template", handleLoadTemplate);
    };
  }, []);

  const [conversationFilePath, setConversationFilePath] = useState<
    null | string
  >(null);
  const [conversationTitle, setConversationTitle] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isConversationListOpen, setIsConversationListOpen] = useState(false);
  const [conversations, setConversations] = useState<
    { filePath: string; title: string }[]
  >([]);
  const [fileChanges, setFileChanges] = useState<PendingFileChange[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<
    PendingPermission[]
  >([]);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // Conversation search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const plugin = view.getPlugin();
  const settings = view.getSettings();
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [showReasoningSession, setShowReasoningSession] = useState(
    settings.showReasoning
  );

  useEffect(() => {
    setShowReasoningSession(settings.showReasoning);
  }, [settings.showReasoning]);

  const lastChunkTimeRef = useRef<number>(0);
  const typingTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const isPromptActiveRef = useRef<boolean>(false);

  // Ref to track the latest volatile state for stable callbacks.
  // This prevents memoized child components (like ChatMessageItem) from unnecessarily re-rendering.
  const stateRef = useRef({
    activeCommand,
    allowedTools,
    contextItems,
    isTyping
  });
  useEffect(() => {
    stateRef.current = { activeCommand, allowedTools, contextItems, isTyping };
  }, [isTyping, contextItems, allowedTools, activeCommand]);

  const {
    appendContent,
    appendReasoning,
    flushNow,
    reasoningMessageIdRef,
    streamingMessageIdRef
  } = useStreamBuffer(
    setMessages,
    settings.showReasoning,
    settings.enableTypingSound,
    settings.enableHapticFeedback
  );

  const saveConversation = useCallback(
    async (
      currentMessages: ChatMessage[],
      currentTitle?: string,
      currentAllowedTools: null | string[] = allowedTools
    ): Promise<void> => {
      if (currentMessages.length === 0) {
        return;
      }

      setIsSaving(true);
      try {
        const title =
          currentTitle ||
          conversationTitle ||
          currentMessages[0]?.content.slice(0, 50) ||
          "Untitled";
        if (!conversationFilePath) {
          const filePath = await plugin.vaultManager.saveConversation(
            currentMessages,
            title,
            currentAllowedTools
          );
          if (filePath) {
            setConversationFilePath(filePath);
            setConversationTitle(title);
          }
        } else {
          const success = await plugin.vaultManager.updateConversation(
            conversationFilePath,
            currentMessages,
            title,
            currentAllowedTools
          );
          if (!success) {
            console.warn(
              "[Hermes] updateConversation returned false for",
              conversationFilePath
            );
          }
        }
      } catch (err) {
        console.error("[Hermes] saveConversation error:", err);
      } finally {
        setIsSaving(false);
      }
    },
    [conversationFilePath, conversationTitle, plugin, allowedTools]
  );

  const clearTypingTimeout = useCallback((): void => {
    if (typingTimeoutRef.current !== null) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, []);

  // Debounced save to prevent duplicate writes when multiple events fire rapidly
  const debouncedSaveRef = useRef<{
    timeoutId: null | ReturnType<typeof setTimeout>;
    lastSaveTime: number;
  }>({
    timeoutId: null,
    lastSaveTime: 0
  });

  const scheduleSave = useCallback(
    (
      currentMessages: ChatMessage[],
      currentTitle?: string,
      currentAllowedTools?: null | string[]
    ): void => {
      const now = Date.now();
      const MIN_SAVE_INTERVAL = 500; // Minimum 500ms between saves

      // Clear any pending save
      if (debouncedSaveRef.current.timeoutId !== null) {
        clearTimeout(debouncedSaveRef.current.timeoutId);
      }

      // Schedule a new save with debounce
      debouncedSaveRef.current.timeoutId = setTimeout(() => {
        // Skip if too soon after last save
        if (now - debouncedSaveRef.current.lastSaveTime < MIN_SAVE_INTERVAL) {
          // Schedule for later
          debouncedSaveRef.current.timeoutId = setTimeout(() => {
            debouncedSaveRef.current.lastSaveTime = Date.now();
            void saveConversation(
              currentMessages,
              currentTitle,
              currentAllowedTools
            );
          }, MIN_SAVE_INTERVAL);
        } else {
          debouncedSaveRef.current.lastSaveTime = Date.now();
          void saveConversation(
            currentMessages,
            currentTitle,
            currentAllowedTools
          );
        }
        debouncedSaveRef.current.timeoutId = null;
      }, 100); // 100ms debounce window
    },
    [saveConversation]
  );

  const resetTypingTimeout = useCallback((): void => {
    clearTypingTimeout();
    typingTimeoutRef.current = setTimeout(() => {
      // If a prompt is still actively executing (e.g. running a tool or waiting for permission),
      // we reschedule the timeout instead of prematurely resetting the typing state.
      if (isPromptActiveRef.current) {
        resetTypingTimeout();
        return;
      }

      setIsTyping(false);
      streamingMessageIdRef.current = null;

      // Schedule a debounced save after typing stops
      setMessages((currentMessages) => {
        scheduleSave(currentMessages);
        return currentMessages;
      });
    }, 3000);
  }, [clearTypingTimeout, scheduleSave]);

  // Subscribe to ACP session updates for streaming
  useEffect(() => {
    const unsubUpdate = view.subscribeToUpdates((update: ChatSessionUpdate) => {
      if (update.type === "message" && update.content) {
        lastChunkTimeRef.current = Date.now();
        resetTypingTimeout();
        appendContent(update.content);
      } else if (update.type === "stop") {
        flushNow();
        clearTypingTimeout();
        setIsTyping(false);
        streamingMessageIdRef.current = null;
        reasoningMessageIdRef.current = null;
        // Clear isRunning from all tool messages so spinners/pulse stop
        setMessages((prev) =>
          prev.map((m) => {
            if (m.role === "tool" && m.isRunning) {
              return {
                ...m,
                isRunning: false,
                toolStatus: m.toolStatus === "error" ? "error" : "complete"
              };
            }
            return m;
          })
        );
        // Save conversation after response completes (debounced)
        setMessages((currentMessages) => {
          scheduleSave(currentMessages);
          return currentMessages;
        });
      } else if (update.type === "reasoning" && update.reasoning) {
        if (settings.showReasoning) {
          appendReasoning(update.reasoning);
        }
      } else if (
        update.type === "tool_start" ||
        update.type === "tool_progress" ||
        update.type === "tool_complete"
      ) {
        flushNow();
        // Always track tool messages in state so the conversation history is accurate,
        // even when showToolUse rendering is disabled. When showToolUse is false:
        // - tool messages are stored with isBackgrounded=true
        // - they don't render as expanded bubbles but the agent's execution context
        //   is preserved in the chat history, preventing hallucinated "denied" narratives
        // - permission confirmations always show as compact status indicators regardless
        const isBackgrounded = !settings.showToolUse;
        if (update.toolCall) {
          // Force isRunning false on tool_complete regardless of backend status
          const isRunning =
            update.type !== "tool_complete" &&
            update.toolCall.status === "running";
          const currentCallId = update.toolCall.callId;
          const currentToolStatus =
            update.toolCall.status === "error"
              ? "error"
              : isRunning
                ? "running"
                : "complete";

          setMessages((prev) => {
            const toolIndex = prev.findIndex(
              (m) => m.role === "tool" && m.toolCallId === currentCallId
            );

            // Reconcile tool name to avoid overwriting with "other" on partial updates
            let resolvedToolName = update.toolCall!.name;
            if (
              toolIndex >= 0 &&
              (resolvedToolName === "other" ||
                resolvedToolName === "unknown-tool")
            ) {
              resolvedToolName = prev[toolIndex]?.toolName || resolvedToolName;
            }

            let toolMsg = "";
            if (update.toolCall!.result) {
              toolMsg = `**Result:**\n\`\`\`text\n${update.toolCall!.result}\n\`\`\``;
            }

            if (toolIndex >= 0) {
              const updated = [...prev];
              updated[toolIndex] = {
                ...prev[toolIndex]!,
                content: toolMsg,
                isBackgrounded,
                isRunning,
                toolName: resolvedToolName,
                toolStatus: currentToolStatus
              };
              return updated;
            }

            const newToolMsg: ChatMessage = {
              content: toolMsg,
              id: generateMessageId(),
              isBackgrounded,
              isRunning,
              isCollapsed: true,
              role: "tool",
              timestamp: Date.now(),
              toolCallId: currentCallId,
              toolName: resolvedToolName,
              toolStatus: currentToolStatus
            };

            const assistantIndex = prev.findIndex(
              (m) => m.id === streamingMessageIdRef.current
            );
            if (assistantIndex >= 0) {
              const updated = [...prev];
              updated.splice(assistantIndex, 0, newToolMsg);
              return updated;
            }
            return [...prev, newToolMsg];
          });
        }
      } else if (update.type === "terminal_output" && update.terminal) {
        flushNow();
        setMessages((prev) => {
          const index = prev.findIndex(
            (m) =>
              m.role === "terminal" && m.terminalId === update.terminal!.id
          );
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = {
              ...updated[index]!,
              content: updated[index]!.content + update.terminal!.output,
              isExited:
                (updated[index]!.isExited ?? false) ||
                (update.terminal!.isExited ?? false)
            };
            return updated;
          }
          return [
            ...prev,
            {
              content: update.terminal!.output,
              id: generateMessageId(),
              isExited: update.terminal!.isExited ?? false,
              role: "terminal",
              terminalId: update.terminal!.id,
              timestamp: Date.now()
            }
          ];
        });
      } else if (
        update.type === "available_commands" &&
        update.availableCommands
      ) {
        // Update cached tool commands from ACP
        const toolCmds = update.availableCommands.map((cmd) => ({
          description: cmd.description,
          execute: async (): Promise<null | string> => {
            // Tool commands are sent as regular prompts; the agent handles them
            return null;
          },
          name: cmd.name
        }));
        setCachedToolCommands(toolCmds);
      }
    });

    const unsubStatus = view.subscribeToConnectionStatus(
      (status: AcpConnectionStatus) => {
        setConnectionStatus(status);
        // Only clear errors when we successfully connect, not while reconnecting,
        // so the user can read the failure reason.
        if (status.state === "connected") {
          setError(null);
        }
      }
    );

    const unsubError = view.subscribeToErrors((err: string) => {
      flushNow();
      clearTypingTimeout();
      const cleaned = stripAnsi(err).trim();
      if (!cleaned) {
        return;
      }
      setError(cleaned);
      setIsTyping(false);
      streamingMessageIdRef.current = null;
      reasoningMessageIdRef.current = null;
      // Clear isRunning from all tool messages so spinners/pulse stop on error
      setMessages((prev) =>
        prev.map((m) => {
          if (m.role === "tool" && m.isRunning) {
            return {
              ...m,
              isRunning: false,
              content: m.content
                .replace('<span class="enodios-tool-helix"></span>', "❌")
                .replace(" *(running...)*", "")
            };
          }
          return m;
        })
      );
    });

    const unsubCommands = view.subscribeToAvailableCommands((commands) => {
      const toolCmds = commands.map((cmd) => ({
        description: cmd.description,
        execute: async (): Promise<null | string> => {
          // Tool commands are sent as regular prompts; the agent handles them
          return null;
        },
        name: cmd.name
      }));
      setCachedToolCommands(toolCmds);
      setAvailableTools((_prev) => {
        const baseTools = [
          { id: "read_file", name: "Read Files" },
          { id: "write_file", name: "Write Files" },
          { id: "terminal", name: "Terminal Commands" },
          { id: "web_search", name: "Web Search" },
          { id: "web_extract", name: "Web Extract" }
        ];
        const dynamicTools = commands.map((c) => ({
          id: c.name,
          name: c.name
        }));
        const all = [...baseTools, ...dynamicTools];
        return Array.from(new Map(all.map((item) => [item.id, item])).values());
      });
      // Refresh slash suggestions if the dropdown is currently open
      if (isSlashOpenRef.current) {
        const query = inputRef.current.slice(1).toLowerCase();
        const all = getSlashCommands();
        const filtered = all.filter(
          (cmd) =>
            cmd.name.toLowerCase().includes(query) ||
            cmd.description.toLowerCase().includes(query)
        );
        setSlashSuggestions(
          filtered.map((cmd) => ({
            description: cmd.description,
            name: cmd.name
          }))
        );
      }
    });

    // Subscribe to pending file changes for approval UI
    const unsubscribeChanges = plugin.fileChangeManager.onChanges((changes) => {
      setFileChanges(changes);
    });

    // Subscribe to pending permission requests for approval UI
    const unsubscribePermissions = plugin.acpClient?.onPermissionsChange(
      (permissions) => {
        setPendingPermissions(permissions);
      }
    );

    // Global Cmd+F shortcut for search
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen((prev) => {
          const next = !prev;
          if (next) {
            setIsConversationListOpen(false);
            setIsSessionSettingsOpen(false);
            setTimeout(() => searchInputRef.current?.focus(), 0);
          } else {
            setSearchQuery("");
            setSearchMatches([]);
          }
          return next;
        });
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      clearTypingTimeout();
      // Clear any pending debounced save
      if (debouncedSaveRef.current.timeoutId !== null) {
        clearTimeout(debouncedSaveRef.current.timeoutId);
      }
      unsubscribeChanges();
      unsubscribePermissions?.();
      unsubUpdate();
      unsubStatus();
      unsubError();
      unsubCommands();
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [
    view,
    plugin,
    clearTypingTimeout,
    scheduleSave,
    appendContent,
    appendReasoning,
    flushNow,
    settings.showReasoning,
    settings.showToolUse
  ]);

  const loadAuditLog = useCallback(async (): Promise<void> => {
    try {
      const entries = await plugin.auditLog.getRecentEntries(50);
      setAuditEntries(entries);
    } catch {
      setAuditEntries([]);
    }
  }, [plugin]);

  const handleClearAuditLog = useCallback(async (): Promise<void> => {
    await plugin.auditLog.clear();
    await loadAuditLog();
  }, [plugin, loadAuditLog]);

  useEffect(() => {
    if (!isAuditLogOpen) {
      return;
    }
    void loadAuditLog();
    const unsubscribe = plugin.auditLog.onChange(() => {
      void loadAuditLog();
    });
    return unsubscribe;
  }, [isAuditLogOpen, loadAuditLog, plugin]);

  const loadConversationList = useCallback(async (): Promise<void> => {
    try {
      const list = await plugin.vaultManager.listConversations();
      setConversations(
        list.map((c) => ({ filePath: c.filePath, title: c.metadata.title }))
      );
    } catch {
      setConversations([]);
    }
  }, [plugin]);

  const handleLoadConversation = useCallback(
    async (filePath: string): Promise<void> => {
      try {
        const loaded = await plugin.vaultManager.loadConversation(filePath);
        if (loaded && loaded.messages.length > 0) {
          setMessages(loaded.messages);
          setConversationFilePath(filePath);
          setConversationTitle(loaded.title);
          setAllowedTools(
            loaded.allowedTools?.length ? loaded.allowedTools : null
          );
          view.clearConversation();
        }
      } catch {
        // Silently ignore load errors
      } finally {
        setIsConversationListOpen(false);
      }
    },
    [plugin, view]
  );

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const onLoadTemplate = useCallback((prompt: string) => {
    setInput(prompt);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }, []);
  const isAtBottomRef = useRef(true);
  const lastPromptRef = useRef<string>("");
  const lastContextItemsRef = useRef<ContextItem[]>([]);

  const handleNewChat = useCallback((): void => {
    if (conversationFilePath) {
      const shouldDelete = window.confirm(
        "Do you want to delete the current conversation file? Click Cancel to keep it and just start a new chat."
      );
      if (shouldDelete) {
        plugin.vaultManager
          .deleteConversation(conversationFilePath)
          .catch(() => {});
      }
    }
    setMessages([]);
    setError(null);
    setConversationFilePath(null);
    setConversationTitle("");
    setContextItems([]);
    setActiveCommand(null);
    setAllowedTools(null);
    view.clearConversation();
  }, [view, conversationFilePath, plugin]);

  // Global Chat Hotkeys (⌘⌥C, ⌘⌥L, ⌘⌥S, ⌘⌥E)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;

      if (isModifier && isAlt) {
        const key = e.key.toLowerCase();
        if (key === "c") {
          e.preventDefault();
          handleNewChat();
        } else if (key === "l") {
          e.preventDefault();
          setIsConversationListOpen((prev) => !prev);
        } else if (key === "s") {
          e.preventDefault();
          setIsSessionSettingsOpen((prev) => !prev);
        } else if (key === "e") {
          e.preventDefault();
          setShowReasoningSession((prev) => !prev);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [handleNewChat]);

  const handleEditSubmit = useCallback(
    async (messageId: string, newText: string): Promise<void> => {
      const current = stateRef.current;

      if (current.isTyping || !newText.trim()) {
        return;
      }

      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === messageId);
        if (index < 0) {
          return prev;
        }

        const truncated = prev.slice(0, index);
        const userMessage: ChatMessage = {
          content: newText,
          id: generateMessageId(),
          role: "user",
          timestamp: Date.now()
        };

        const streamingMessageId = generateMessageId();
        streamingMessageIdRef.current = streamingMessageId;
        reasoningMessageIdRef.current = null;

        const assistantPlaceholder: ChatMessage = {
          content: "",
          id: streamingMessageId,
          role: "assistant",
          timestamp: Date.now()
        };

        return [...truncated, userMessage, assistantPlaceholder];
      });

      setIsTyping(true);
      setError(null);
      lastPromptRef.current = newText;
      lastContextItemsRef.current = [...current.contextItems];

      isPromptActiveRef.current = true;
      try {
        await view.sendPrompt(newText, current.contextItems, {
          allowedTools: current.allowedTools
        });
      } catch (err) {
        setError(
          `Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`
        );
      } finally {
        setIsTyping(false);
        streamingMessageIdRef.current = null;
        isPromptActiveRef.current = false;
      }
    },
    [view]
  );

  const handleRetry = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (!lastPromptRef.current || current.isTyping) {
      return;
    }
    setError(null);
    setIsTyping(true);

    const streamingMessageId = generateMessageId();
    streamingMessageIdRef.current = streamingMessageId;
    reasoningMessageIdRef.current = null;
    const assistantPlaceholder: ChatMessage = {
      content: "",
      id: streamingMessageId,
      role: "assistant",
      timestamp: Date.now()
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    isPromptActiveRef.current = true;
    try {
      await view.sendPrompt(
        lastPromptRef.current,
        lastContextItemsRef.current,
        { allowedTools: current.allowedTools }
      );
    } catch (err) {
      setError(
        `Retry failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsTyping(false);
      streamingMessageIdRef.current = null;
      isPromptActiveRef.current = false;
    }
  }, [view]);

  const handleSend = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const trimmed = inputRef.current.trim();
    const fullText = current.activeCommand
      ? `/${current.activeCommand} ${trimmed}`.trim()
      : trimmed;
    if (!fullText || current.isTyping) {
      return;
    }

    // Rate limiting
    const now = Date.now();
    const elapsed = now - lastSendTimeRef.current;
    if (elapsed < RATE_LIMIT_MS) {
      const remaining = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      setRateLimitSeconds(remaining);
      setTimeout(() => {
        setRateLimitSeconds(0);
      }, RATE_LIMIT_MS - elapsed);
      return;
    }
    lastSendTimeRef.current = now;
    setRateLimitSeconds(0);

    // Check for slash commands
    const slashCmd = parseSlashCommand(fullText);
    if (slashCmd) {
      setInput("");
      setActiveCommand(null);
      setIsSlashOpen(false);

      const userMessage: ChatMessage = {
        content: fullText,
        id: generateMessageId(),
        role: "user",
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, userMessage]);

      if (slashCmd.command.name === "clear") {
        handleNewChat();
        return;
      }

      setIsTyping(true);
      try {
        const result = await slashCmd.command.execute(plugin, slashCmd.args);
        if (result) {
          const systemMessage: ChatMessage = {
            content: result,
            id: generateMessageId(),
            role: "system",
            timestamp: Date.now()
          };
          setMessages((prev) => [...prev, systemMessage]);
        } else {
          // Tool commands return null — forward to agent as a prompt
          lastPromptRef.current = fullText;
          lastContextItemsRef.current = [...current.contextItems];

          const streamingMessageId = generateMessageId();
          streamingMessageIdRef.current = streamingMessageId;
          reasoningMessageIdRef.current = null;
          const assistantPlaceholder: ChatMessage = {
            content: "",
            id: streamingMessageId,
            role: "assistant",
            timestamp: Date.now()
          };
          setMessages((prev) => [...prev, assistantPlaceholder]);

          isPromptActiveRef.current = true;
          try {
            await view.sendPrompt(fullText, current.contextItems, {
              allowedTools: current.allowedTools
            });
          } catch (err) {
            setError(
              `Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`
            );
          } finally {
            setIsTyping(false);
            streamingMessageIdRef.current = null;
            isPromptActiveRef.current = false;
          }
        }
      } catch (err) {
        const errorMessage: ChatMessage = {
          content: `Error executing /${slashCmd.command.name}: ${err instanceof Error ? err.message : String(err)}`,
          id: generateMessageId(),
          role: "system",
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsTyping(false);
        streamingMessageIdRef.current = null;
      }
      return;
    }

    const userMessage: ChatMessage = {
      content: fullText,
      id: generateMessageId(),
      role: "user",
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setActiveCommand(null);
    setError(null);
    setIsTyping(true);
    lastPromptRef.current = fullText;
    lastContextItemsRef.current = [...current.contextItems];

    // Create a placeholder assistant message for streaming
    const streamingMessageId = generateMessageId();
    streamingMessageIdRef.current = streamingMessageId;
    reasoningMessageIdRef.current = null;
    const assistantPlaceholder: ChatMessage = {
      content: "",
      id: streamingMessageId,
      role: "assistant",
      timestamp: Date.now()
    };
    setMessages((prev) => [...prev, assistantPlaceholder]);

    isPromptActiveRef.current = true;
    try {
      await view.sendPrompt(fullText, current.contextItems, {
        allowedTools: current.allowedTools
      });
    } catch (err) {
      setError(
        `Failed to get a response: ${err instanceof Error ? err.message : String(err)}. Click to retry.`
      );
    } finally {
      setIsTyping(false);
      streamingMessageIdRef.current = null;
      isPromptActiveRef.current = false;
    }
  }, [view, plugin, handleNewChat]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (
        e.key === "Backspace" &&
        inputRef.current === "" &&
        stateRef.current.activeCommand
      ) {
        setActiveCommand(null);
        return;
      }

      if (handleSlashKeyDown(e)) return;

      if (isAutocompleteOpen && autocompleteSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          cycleSuggestions("next");
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          cycleSuggestions("prev");
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selected = autocompleteSuggestions[autocompleteSelectionIndex];
          if (selected) {
            insertAutocomplete(selected);
          }
          return;
        }
        if (e.key === "Escape") {
          setIsAutocompleteOpen(false);
          return;
        }
      }

      if (e.key === "ArrowUp" && inputRef.current === "") {
        const userMsgs = messages.filter((m) => m.role === "user");
        if (userMsgs.length > 0) {
          e.preventDefault();
          const lastUser = userMsgs[userMsgs.length - 1]!;
          setEditingMessageId(lastUser.id);
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [
      isSlashOpen,
      slashSuggestions,
      slashSelectionIndex,
      isAutocompleteOpen,
      autocompleteSuggestions,
      autocompleteSelectionIndex,
      handleSend,
      messages,
      setEditingMessageId
    ]
  );

  const insertAutocomplete = useCallback(
    (suggestion: AutocompleteSuggestion): void => {
      // Instead of inserting text, add the selected item to context.
      if (suggestion.type === "note" || suggestion.type === "folder") {
        const contextType = suggestion.type;
        const contextId = `${contextType}-${suggestion.text}`;
        const isDuplicate = contextItems.some((item) => item.id === contextId);

        if (!isDuplicate) {
          setContextItems((prev) => [
            ...prev,
            {
              id: contextId,
              text: suggestion.text.split("/").pop() || suggestion.text, // show basename
              type: contextType
            }
          ]);
        }

        // Clear the autocomplete part from the input
        const value = input;
        const lastOpen = Math.max(
          value.lastIndexOf("[["),
          value.lastIndexOf("{")
        );
        if (lastOpen !== -1) {
          setInput(value.substring(0, lastOpen));
        } else {
          setInput("");
        }
      } else if (suggestion.type === "citation") {
        // For citations, we want to insert the text `[@citationKey]` into the textarea
        const value = input;
        const lastOpen = value.lastIndexOf("[@");
        if (lastOpen !== -1) {
          const key = suggestion.id.replace(/^citation-/, "");
          const before = value.substring(0, lastOpen);
          const after = value.substring(
            lastOpen + 2 + autocompleteQuery.length
          );
          setInput(before + `[@${key}]` + after);
        }
      }

      setIsAutocompleteOpen(false);
      setAutocompleteQuery("");
      setAutocompleteSuggestions([]);
      setAutocompleteSelectionIndex(0);

      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [input, contextItems, autocompleteQuery]
  );

  const resolveActiveFile = useCallback((): TFile | null => {
    const file = plugin.app.workspace.getActiveFile();
    if (file) return file;

    // Fallback: check most recent leaf
    const mostRecent = plugin.app.workspace.getMostRecentLeaf();
    if (mostRecent?.view instanceof MarkdownView && mostRecent.view.file) {
      return mostRecent.view.file;
    }

    // Fallback 2: first open markdown leaf
    const markdownLeaves = plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      if (leaf.view instanceof MarkdownView && leaf.view.file) {
        return leaf.view.file;
      }
    }
    return null;
  }, [plugin]);

  const handleContextClick = useCallback(async (): Promise<void> => {
    const activeFile = resolveActiveFile();
    let selectedText = "";

    const allViews = plugin.app.workspace.getLeavesOfType("markdown");
    for (const leaf of allViews) {
      if (leaf.view instanceof MarkdownView) {
        const sel = leaf.view.editor.getSelection();
        if (sel) {
          selectedText = sel;
          break;
        }
      }
    }

    const autoAddEnabled = settings.contextEntireNote;

    if (selectedText.length > 0) {
      // Check if selection is a block reference like [[Note#Heading]]
      const blockRefMatch = /^\[\[(.+?)(?:#(.+?))?\]\]$/.exec(selectedText);
      if (blockRefMatch && activeFile) {
        const resolved = await resolveBlockReference(plugin, selectedText);
        if (resolved) {
          const isDuplicate = contextItems.some(
            (item) =>
              item.type === "note" &&
              item.id ===
                `block-${resolved.path}-${blockRefMatch[2] ?? "full"}`
          );
          if (isDuplicate) {
            return;
          }

          setContextItems((prev) => [
            ...prev,
            {
              id: `block-${resolved.path}-${blockRefMatch[2] ?? "full"}`,
              text: `${activeFile.basename}${blockRefMatch[2] ? ` #${blockRefMatch[2]}` : ""}`,
              type: "note"
            }
          ]);
          return;
        }
      }

      // Check if selection is within a code block, heading, or list
      if (activeFile) {
        const content = await plugin.app.vault.read(activeFile);
        const blocks = parseBlockReferences(content);
        const editor =
          plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (editor) {
          const from = editor.getCursor("from");
          const to = editor.getCursor("to");
          const startLine = from.line;
          const endLine = to.line;

          // Find the block that contains the selection
          const containingBlock = blocks.find(
            (b) => b.startLine <= startLine && b.endLine >= endLine
          );

          if (containingBlock && containingBlock.type !== "paragraph") {
            const isDuplicate = contextItems.some(
              (item) =>
                item.type === "note" &&
                item.id ===
                  `block-${activeFile.path}-${containingBlock.startLine}`
            );
            if (isDuplicate) {
              return;
            }

            setContextItems((prev) => [
              ...prev,
              {
                id: `block-${activeFile.path}-${containingBlock.startLine}`,
                text: `${activeFile.basename} (${containingBlock.type})`,
                type: "note"
              }
            ]);
            return;
          }
        }
      }

      const isDuplicate = contextItems.some(
        (item) => item.type === "selection" && item.text === selectedText
      );
      if (isDuplicate) {
        return;
      }

      setContextItems((prev) => [
        ...prev,
        {
          id: `selection-${Date.now()}`,
          text: selectedText,
          type: "selection"
        }
      ]);
    } else if (activeFile && !autoAddEnabled) {
      const isDuplicate = contextItems.some(
        (item) => item.type === "note" && item.id === `note-${activeFile.path}`
      );
      if (isDuplicate) {
        return;
      }

      setContextItems((prev) => [
        ...prev,
        {
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: "note"
        }
      ]);
    }
  }, [plugin, settings, contextItems, resolveActiveFile]);

  const removeContextItem = useCallback((id: string): void => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleAttachFiles = useCallback(
    async (files: FileList): Promise<void> => {
      const activeFile = resolveActiveFile();
      const targetFolder = activeFile?.parent?.path ?? "";
      const copied: string[] = [];

      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) {
          new Notice(
            `File "${file.name}" exceeds the 5MB limit and was skipped. Please process large files in another app.`
          );
          continue;
        }

        try {
          const arrayBuffer = await file.arrayBuffer();
          const fileName = file.name;
          const targetPath = targetFolder
            ? `${targetFolder}/${fileName}`
            : fileName;

          // Check if file already exists
          const existing = plugin.app.vault.getAbstractFileByPath(targetPath);
          if (existing) {
            continue; // Skip duplicates silently
          }

          const newFile = await plugin.app.vault.createBinary(
            targetPath,
            arrayBuffer
          );
          copied.push(fileName);

          const isPdf = fileName.toLowerCase().endsWith(".pdf");
          const isImage = /\.(jpe?g|png|gif|webp)$/i.test(fileName);
          const base64 = Buffer.from(arrayBuffer).toString("base64");

          if (isPdf) {
            setContextItems((prev) => [
              ...prev,
              {
                data: base64,
                id: `pdf-${targetPath}`,
                mimeType: "application/pdf",
                text: fileName,
                type: "pdf"
              }
            ]);

            if (settings.autoExtractPdfAnnotations) {
              try {
                const annots =
                  await plugin.pdfAnnotationManager.extractAnnotations(newFile);
                if (annots.length > 0) {
                  const markdown =
                    plugin.pdfAnnotationManager.formatAnnotationsMarkdown(
                      annots,
                      fileName
                    );
                  setContextItems((prev) => [
                    ...prev,
                    {
                      id: `pdf-annotations-${targetPath}`,
                      text: markdown, // The actual text content is the markdown summary
                      type: "selection"
                    }
                  ]);
                }
              } catch (err) {
                plugin.debug.error(
                  "Auto-extraction of PDF annotations failed",
                  err
                );
              }
            }
          } else if (isImage) {
            const ext = fileName.split(".").pop()?.toLowerCase();
            const mimeType =
              ext === "png"
                ? "image/png"
                : ext === "gif"
                  ? "image/gif"
                  : ext === "webp"
                    ? "image/webp"
                    : "image/jpeg";
            setContextItems((prev) => [
              ...prev,
              {
                data: base64,
                id: `image-${targetPath}`,
                mimeType,
                text: fileName,
                type: "image"
              }
            ]);
          } else if (fileName.endsWith(".md")) {
            setContextItems((prev) => [
              ...prev,
              {
                id: `note-${targetPath}`,
                text: fileName.replace(/\.md$/, ""),
                type: "note"
              }
            ]);
          }
        } catch {
          // Silently ignore individual file errors
        }
      }

      if (copied.length > 0) {
        new Notice(`Copied ${copied.length} file(s) to vault`);
      }
    },
    [plugin, settings, contextItems, resolveActiveFile]
  );

  // Auto-scroll to bottom
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (!container) {
        return;
      }
      // Check if user is scrolled to the bottom. The +5 is a buffer for fractional pixels and borders.
      isAtBottomRef.current =
        container.scrollHeight - container.clientHeight <=
        container.scrollTop + 5;
    };

    // The ResizeObserver will fire whenever the content's size changes.
    // This is perfect for catching when async content (like Markdown code blocks) finishes rendering.
    const observer = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    observer.observe(container);
    container.addEventListener("scroll", handleScroll, { passive: true });

    // When new messages are added, if we were at the bottom, scroll to the new bottom.
    if (isAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [messages]);

  // Auto-add context when active file changes — use Obsidian event instead of useEffect polling
  useEffect(() => {
    if (!settings.contextEntireNote) {
      return undefined;
    }

    const handleActiveLeafChange = (): void => {
      const currentActiveFile = plugin.app.workspace.getActiveFile();
      if (!currentActiveFile) {
        return;
      }

      setContextItems((prev) => {
        const currentNoteItem = prev.find((item) => item.type === "note");
        if (currentNoteItem?.id === `note-${currentActiveFile.path}`) {
          return prev;
        }
        return [
          ...prev.filter((item) => item.type !== "note"),
          {
            id: `note-${currentActiveFile.path}`,
            text: currentActiveFile.basename,
            type: "note"
          }
        ];
      });
    };

    // Set initial context
    handleActiveLeafChange();

    const eventRef = plugin.app.workspace.on(
      "active-leaf-change",
      handleActiveLeafChange
    );

    return () => {
      plugin.app.workspace.offref(eventRef);
    };
  }, [plugin, settings.contextEntireNote]);

  // Autocomplete trigger detection
  useEffect(() => {
    if (input.length === 0) {
      return;
    }

    const lastChar = input[input.length - 1];
    const lastTwoChars = input.length > 1 ? input.slice(-2) : "";

    const justOpened =
      (lastChar === "{" && input[input.length - 2] !== "\\") ||
      (lastTwoChars === "[[" && input[input.length - 3] !== "\\") ||
      (lastTwoChars === "[@" && input[input.length - 3] !== "\\");

    if (justOpened) {
      setIsAutocompleteOpen(true);
      setAutocompleteQuery("");
      setAutocompleteSelectionIndex(0);
    } else if (isAutocompleteOpen) {
      const lastOpen = Math.max(
        input.lastIndexOf("[["),
        input.lastIndexOf("{"),
        input.lastIndexOf("[@")
      );
      if (lastOpen >= 0) {
        const isCitation = input.substring(lastOpen, lastOpen + 2) === "[@";
        const isWikiLink = !isCitation && input[lastOpen] === "[";
        const offset = isWikiLink || isCitation ? 2 : 1;
        const query = input.substring(lastOpen + offset);
        setAutocompleteQuery(query);
        if (query.length > 0) {
          setAutocompleteSelectionIndex(0);
        }
      }
    }
  }, [input, isAutocompleteOpen]);

  // Fetch autocomplete suggestions
  useEffect(() => {
    if (!isAutocompleteOpen) {
      setAutocompleteSuggestions([]);
      return;
    }

    const lastOpen = Math.max(
      inputRef.current.lastIndexOf("[["),
      inputRef.current.lastIndexOf("{"),
      inputRef.current.lastIndexOf("[@")
    );
    const isCitation =
      lastOpen !== -1 &&
      inputRef.current.substring(lastOpen, lastOpen + 2) === "[@";

    if (isCitation) {
      const fetchCitations = async () => {
        try {
          await plugin.citationManager.loadBibliography();
          const results = plugin.citationManager.search(autocompleteQuery);
          const suggestions: AutocompleteSuggestion[] = results
            .slice(0, 5)
            .map((item) => ({
              id: `citation-${item.key}`,
              text: item.key,
              type: "citation"
            }));
          setAutocompleteSuggestions(suggestions);
        } catch {
          setAutocompleteSuggestions([]);
        }
      };
      void fetchCitations();
      return;
    }

    const vault = plugin.app.vault;
    const files = vault.getMarkdownFiles();
    const queryLower = autocompleteQuery.toLowerCase();

    const matches =
      queryLower === ""
        ? files
        : files.filter(
            (file) =>
              file.path.toLowerCase().includes(queryLower) ||
              file.basename.toLowerCase().includes(queryLower)
          );

    const recentFiles = matches
      .map((file) => ({ file, mtime: file.stat.mtime }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);

    const suggestions: AutocompleteSuggestion[] = recentFiles.map(
      ({ file }) => ({
        id: `note-${file.path}`,
        text: file.path,
        type: "note"
      })
    );

    if (autocompleteQuery.includes("/")) {
      const folders = new Set<string>();
      for (const file of files) {
        const parts = file.path.split("/");
        for (let i = 1; i < parts.length; i++) {
          const folderPath = parts.slice(0, i).join("/");
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
          type: "folder" as const
        }));

      suggestions.push(...folderSuggestions);
    }

    setAutocompleteSuggestions(suggestions.slice(0, 5));
  }, [autocompleteQuery, isAutocompleteOpen, plugin]);

  // Close autocomplete on bracket close
  useEffect(() => {
    if (input.endsWith("]]") || input.endsWith("}") || input.endsWith("]")) {
      setIsAutocompleteOpen(false);
    }
  }, [input]);

  // Slash command detection
  useEffect(() => {
    if (input === "/") {
      setIsSlashOpen(true);
      setSlashSelectionIndex(0);
      const commands = getSlashCommands();
      setSlashSuggestions(
        commands.map((cmd) => ({
          description: cmd.description,
          name: cmd.name
        }))
      );
      return;
    }

    if (input.startsWith("/") && !/\s/.test(input)) {
      const query = input.slice(1).toLowerCase();
      const commands = getSlashCommands();
      const filtered = commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query)
      );
      if (filtered.length > 0) {
        setSlashSuggestions(
          filtered.map((cmd) => ({
            description: cmd.description,
            name: cmd.name
          }))
        );
        setIsSlashOpen(true);
      } else {
        // No cached match — still show as a runnable agent command
        const syntheticName = input.slice(1).split(/\s/)[0] ?? "";
        setSlashSuggestions([
          {
            description: "Send command to Enodios",
            name: syntheticName
          }
        ]);
        setIsSlashOpen(true);
      }
    } else {
      setIsSlashOpen(false);
      setSlashSuggestions([]);
    }
  }, [input]);

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const value = e.target.value;
      setInput(value);
      handleSlashInput(value);

      const target = e.target;
      target.style.height = "auto";
      target.style.height = `${target.scrollHeight}px`;
    },
    [setInput, handleSlashInput]
  );

  // Conversation search handlers
  const performSearch = useCallback(
    (query: string): void => {
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
    },
    [messages]
  );

  const jumpToMatch = useCallback(
    (direction: "next" | "prev"): void => {
      if (searchMatches.length === 0) {
        return;
      }
      const newIndex =
        direction === "next"
          ? (currentMatchIndex + 1) % searchMatches.length
          : (currentMatchIndex - 1 + searchMatches.length) %
            searchMatches.length;
      setCurrentMatchIndex(newIndex);
      const msgIndex = searchMatches[newIndex];
      if (msgIndex !== undefined) {
        const msgId = messages[msgIndex]?.id;
        const el = msgId ? messageRefs.current.get(msgId) : undefined;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("enodios-search-highlight");
          setTimeout(() => {
            el.classList.remove("enodios-search-highlight");
          }, 2000);
        }
      }
    },
    [searchMatches, currentMatchIndex, messages]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        jumpToMatch("next");
      } else if (e.key === "Escape") {
        setIsSearchOpen(false);
        setSearchQuery("");
        setSearchMatches([]);
      }
    },
    [jumpToMatch]
  );

  return (
    <div className="enodios-chat-container">
      <ChatHeader
        agentName={settings.chatAgentName || "Hermes"}
        isSaving={isSaving}
        onNewChat={handleNewChat}
        onOpenSettings={() => {
          plugin.openSettings();
        }}
        onToggleAuditLog={() => {
          setIsConversationListOpen(false);
          setIsSessionSettingsOpen(false);
          setIsAuditLogOpen((prev) => !prev);
        }}
        onToggleConversationList={() => {
          if (!isConversationListOpen) {
            void loadConversationList();
          }
          setIsSessionSettingsOpen(false);
          setIsAuditLogOpen(false);
          setIsConversationListOpen((prev) => !prev);
        }}
        onToggleReasoning={() => {
          setShowReasoningSession((prev) => !prev);
        }}
        onToggleSearch={() => {
          setIsSearchOpen((prev) => !prev);
          setIsConversationListOpen(false);
          setIsSessionSettingsOpen(false);
          setIsAuditLogOpen(false);
          if (!isSearchOpen) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
          }
        }}
        onToggleSessionSettings={() => {
          setIsConversationListOpen(false);
          setIsAuditLogOpen(false);
          setIsSessionSettingsOpen((prev) => !prev);
        }}
        showReasoning={showReasoningSession}
      />

      {isSessionSettingsOpen && (
        <SessionSettingsPanel
          allowedTools={allowedTools}
          availableTools={availableTools}
          onClose={() => {
            setIsSessionSettingsOpen(false);
          }}
          onToolsChange={(tools) => {
            setAllowedTools(tools);
            if (conversationFilePath) {
              setMessages((current) => {
                scheduleSave(current, conversationTitle, tools);
                return current;
              });
            }
          }}
        />
      )}

      {isAuditLogOpen && (
        <AuditLogPanel
          entries={auditEntries}
          onClear={handleClearAuditLog}
          onClose={() => {
            setIsAuditLogOpen(false);
          }}
        />
      )}

      {isConversationListOpen && (
        <div className="enodios-conversation-list">
          <div className="enodios-conversation-list-header">
            <span>Previous Conversations</span>
            <button
              className="enodios-icon-btn"
              onClick={() => {
                setIsConversationListOpen(false);
              }}
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>
          {conversations.length === 0
? (
            <div className="enodios-conversation-empty">
              No saved conversations
            </div>
          )
: (
            <ul>
              {conversations.slice(0, 5).map((conv) => (
                <li key={conv.filePath}>
                  <button
                    className="enodios-conversation-item"
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
        <div className="enodios-search-bar">
          <input
            className="enodios-search-input"
            onChange={(e) => {
              setSearchQuery(e.target.value);
              performSearch(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search messages..."
            ref={searchInputRef}
            type="text"
            value={searchQuery}
          />
          {searchMatches.length > 0 && (
            <span className="enodios-search-count">
              {currentMatchIndex + 1} / {searchMatches.length}
            </span>
          )}
          <button
            className="enodios-icon-btn"
            onClick={() => {
              jumpToMatch("prev");
            }}
            title="Previous match"
            type="button"
          >
            ↑
          </button>
          <button
            className="enodios-icon-btn"
            onClick={() => {
              jumpToMatch("next");
            }}
            title="Next match"
            type="button"
          >
            ↓
          </button>
          <button
            className="enodios-icon-btn"
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery("");
              setSearchMatches([]);
            }}
            title="Close search"
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <div className="enodios-chat-content" ref={chatContainerRef}>
        {messages.length === 0 && !error && (
          <OnboardingPanel
            agentName={settings.chatAgentName || "Hermes"}
            hasSeenOnboarding={settings.hasSeenOnboarding}
            onDismiss={() => {
              // @ts-expect-error - settings are mutable at runtime
              plugin.settings.hasSeenOnboarding = true;
              void plugin.settingsManager.saveToFile();
            }}
            onLoadTemplate={onLoadTemplate}
            templates={templates}
          />
        )}
        <MessageList
          agentName={settings.chatAgentName || "Hermes"}
          connectionStatus={connectionStatus}
          editingMessageId={editingMessageId}
          error={error}
          handleEditSubmit={handleEditSubmit}
          isTyping={isTyping}
          messageRefs={messageRefs}
          messages={messages}
          setEditingMessageId={setEditingMessageId}
          showReasoningSession={showReasoningSession}
          view={view}
        />
        {error && (
          <div className="enodios-error" role="alert">
            <span className="enodios-error-icon">⚠️</span>
            <span className="enodios-error-text">
              {error || "An error occurred"}
            </span>
            <button
              className="enodios-error-dismiss"
              onClick={() => {
                setError(null);
              }}
              title="Dismiss"
              type="button"
            >
              ✕
            </button>
            <button
              className="enodios-error-retry"
              onClick={handleRetry}
              title="Retry"
              type="button"
            >
              Retry
            </button>
          </div>
        )}
        <TokenUsageFooter visible={settings.showTokenCount} />
      </div>

      {/* Pending changes and permissions panels outside scrollable area */}
      {fileChanges.length > 0 && settings.showPendingChangesInChat && (
        <PendingChangesPanel
          changes={fileChanges}
          onApprove={(id, contentOverride) =>
            void plugin.fileChangeManager.approveChange(id, contentOverride)}
          onApproveAll={() => void plugin.fileChangeManager.approveAll()}
          onClearResolved={() => {
            plugin.fileChangeManager.clearResolved();
          }}
          onReject={(id) => {
            plugin.fileChangeManager.rejectChange(id);
          }}
          onRejectAll={() => {
            plugin.fileChangeManager.rejectAll();
          }}
        />
      )}
      {pendingPermissions.length > 0 && (
        <PendingPermissionsPanel
          onApprove={(permissionId, optionId) => {
            plugin.acpClient?.resolvePermission(permissionId, optionId);
          }}
          onApproveAll={() => {
            plugin.acpClient?.resolveAllPermissions();
          }}
          onRejectAll={() => {
            plugin.acpClient?.cancelAllPermissions();
          }}
          permissions={pendingPermissions}
        />
      )}

      <ChatInput
        activeCommand={activeCommand}
        autocompleteQuery={autocompleteQuery}
        autocompleteSelectionIndex={autocompleteSelectionIndex}
        autocompleteSuggestions={autocompleteSuggestions}
        contextItems={contextItems}
        input={input}
        isAutocompleteOpen={isAutocompleteOpen}
        isSlashOpen={isSlashOpen}
        isTyping={isTyping}
        onAttachFiles={handleAttachFiles}
        onContextClick={handleContextClick}
        onInputChange={handleTextareaChange}
        onInputKeyDown={handleInputKeyDown}
        onRemoveCommand={() => {
          setActiveCommand(null);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        onRemoveContextItem={removeContextItem}
        onSelectAutocomplete={insertAutocomplete}
        onSelectSlash={(name) => {
          setActiveCommand(name);
          setInput("");
          setIsSlashOpen(false);
          setSlashSuggestions([]);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
        onSend={handleSend}
        onStop={() => {
          view.cancelPrompt();
        }}
        rateLimitSeconds={rateLimitSeconds}
        slashSelectionIndex={slashSelectionIndex}
        slashSuggestions={slashSuggestions}
        textareaRef={textareaRef}
      />
    </div>
  );
}

interface SessionSettingsPanelProps {
  allowedTools: null | string[];
  availableTools: { id: string; name: string }[];
  onClose: () => void;
  onToolsChange: (tools: null | string[]) => void;
}

const SessionSettingsPanel = memo(
  ({
    allowedTools,
    availableTools,
    onClose,
    onToolsChange
  }: SessionSettingsPanelProps): ReactElement => {
    const isAllAllowed = allowedTools === null;

    const toggleTool = (toolId: string): void => {
      if (isAllAllowed) {
        // If previously using default, start an explicit list excluding the toggled tool
        onToolsChange(
          availableTools.map((t) => t.id).filter((id) => id !== toolId)
        );
      } else {
        const newTools = allowedTools.includes(toolId)
          ? allowedTools.filter((id) => id !== toolId)
          : [...allowedTools, toolId];
        onToolsChange(newTools);
      }
    };

    return (
      <div className="enodios-session-settings">
        <div className="enodios-session-settings-header">
          <span>Session Tools</span>
          <button
            className="enodios-icon-btn"
            onClick={onClose}
            title="Close"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="enodios-session-settings-content">
          <p className="enodios-session-settings-desc">
            Select which tools the agent is allowed to use during this specific
            chat session.
          </p>
          <div className="enodios-session-settings-actions">
            <button
              className="enodios-btn-secondary"
              onClick={() => {
                onToolsChange(null);
              }}
              title="Remove session-specific restrictions"
              type="button"
            >
              Reset Default
            </button>
            <button
              className="enodios-btn-secondary"
              onClick={() => {
                onToolsChange(availableTools.map((t) => t.id));
              }}
              type="button"
            >
              Allow All
            </button>
            <button
              className="enodios-btn-secondary"
              onClick={() => {
                onToolsChange([]);
              }}
              type="button"
            >
              Disable All
            </button>
          </div>
          {availableTools.map((tool) => (
            <label className="enodios-session-tool-toggle" key={tool.id}>
              <input
                checked={isAllAllowed || allowedTools.includes(tool.id)}
                onChange={() => {
                  toggleTool(tool.id);
                }}
                type="checkbox"
              />
              <span>{tool.name}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }
);

interface ChatInputProps {
  activeCommand: string | null;
  autocompleteQuery: string;
  autocompleteSelectionIndex: number;
  autocompleteSuggestions: AutocompleteSuggestion[];
  contextItems: ContextItem[];
  input: string;
  isAutocompleteOpen: boolean;
  isSlashOpen: boolean;
  isTyping: boolean;
  onAttachFiles: (files: FileList) => void;
  onContextClick: () => void;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveCommand: () => void;
  onRemoveContextItem: (id: string) => void;
  onSelectAutocomplete: (suggestion: AutocompleteSuggestion) => void;
  onSelectSlash: (name: string) => void;
  onSend: () => void;
  onStop: () => void;
  rateLimitSeconds: number;
  slashSelectionIndex: number;
  slashSuggestions: { description: string; name: string }[];
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

const ChatInput = memo(
  ({
    activeCommand,
    autocompleteSelectionIndex,
    autocompleteSuggestions,
    contextItems,
    input,
    isAutocompleteOpen,
    isSlashOpen,
    isTyping,
    onAttachFiles,
    onContextClick,
    onInputChange,
    onInputKeyDown,
    onRemoveCommand,
    onRemoveContextItem,
    onSelectAutocomplete,
    onSelectSlash,
    onSend,
    onStop,
    rateLimitSeconds,
    slashSelectionIndex,
    slashSuggestions,
    textareaRef
  }: ChatInputProps): ReactElement => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<HTMLDivElement>(null);

    // Auto-resize textarea whenever input changes (including programmatic insertions like file paths)
    useEffect(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    }, [input, textareaRef]);

    useEffect(() => {
      if (autocompleteRef.current) {
        const selected = autocompleteRef.current.querySelector(".selected");
        if (selected) {
          selected.scrollIntoView({ block: "nearest" });
        }
      }
    }, [slashSelectionIndex, autocompleteSelectionIndex]);

    return (
      <div className="enodios-input-wrapper">
        {isSlashOpen && slashSuggestions.length > 0 && (
          <div
            className="enodios-autocomplete enodios-slash-commands"
            ref={autocompleteRef}
          >
            <div className="enodios-autocomplete-hint">Commands</div>
            {slashSuggestions.map((suggestion, index) => (
              <div
                aria-selected={index === slashSelectionIndex}
                className={`enodios-autocomplete-item ${index === slashSelectionIndex ? "selected" : ""}`}
                key={suggestion.name}
                onClick={() => {
                  onSelectSlash(suggestion.name);
                }}
                role="option"
              >
                <span className="enodios-autocomplete-icon">⚡</span>
                <span className="enodios-autocomplete-text">
                  <strong>/{suggestion.name}</strong>
                  <span className="enodios-autocomplete-desc">
                    {suggestion.description}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="enodios-input-container">
          <div className="enodios-input-top">
            <div className="enodios-context-list">
              {activeCommand && (
                <div className="enodios-context-chip">
                  <button
                    className="enodios-context-remove"
                    onClick={onRemoveCommand}
                    title="Remove command"
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="12"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="12"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <line x1="18" x2="6" y1="6" y2="18" />
                      <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                  </button>
                  <span className="enodios-context-text">
                    ⚡ /{activeCommand}
                  </span>
                </div>
              )}
              {contextItems.map((item) => (
                <div className="enodios-context-chip" key={item.id}>
                  <button
                    className="enodios-context-remove"
                    onClick={() => {
                      onRemoveContextItem(item.id);
                    }}
                    title="Remove from context"
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="12"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="12"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <line x1="18" x2="6" y1="6" y2="18" />
                      <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                  </button>
                  <span className="enodios-context-text">
                    {item.type === "image" ? "🖼️ " : ""}
                    {item.type === "pdf" ? "📄 " : ""}
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
            <button
              className="enodios-stop-btn"
              disabled={!isTyping}
              onClick={() => {
                onStop();
              }}
              title="Stop generating"
              type="button"
            >
              <svg
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect height="12" width="12" x="6" y="6" />
              </svg>
            </button>
          </div>
          <textarea
            className="enodios-input"
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
            placeholder="Message Hermes..."
            ref={textareaRef}
            rows={1}
            value={input}
          />
          <div className="enodios-input-bottom">
            <div className="enodios-input-left">
              <button
                className="enodios-context-btn"
                onClick={onContextClick}
                title="Add Context"
                type="button"
              >
                <svg
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.9" />
                </svg>
              </button>
            </div>
            <div className="enodios-input-right">
              <input
                accept="*/*"
                multiple
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onAttachFiles(e.target.files);
                  }
                  e.target.value = "";
                }}
                ref={fileInputRef}
                style={{ display: "none" }}
                type="file"
              />
              <button
                className="enodios-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files"
                type="button"
              >
                <svg
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              {rateLimitSeconds > 0 && (
                <span className="enodios-rate-limit">{rateLimitSeconds}s</span>
              )}
              <button
                className="enodios-send-btn"
                disabled={isTyping || !input.trim() || rateLimitSeconds > 0}
                onClick={onSend}
                title="Send"
                type="button"
              >
                <svg
                  fill="none"
                  height="16"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <line x1="22" x2="11" y1="2" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {isAutocompleteOpen && autocompleteSuggestions.length > 0 && (
          <div
            className="enodios-autocomplete enodios-autocomplete-rich"
            ref={autocompleteRef}
          >
            <div className="enodios-autocomplete-hint">
              {autocompleteSuggestions[0]?.type === "citation"
                ? "Type to search citations..."
                : "Type to search files..."}
            </div>
            {autocompleteSuggestions.map((suggestion, index) => (
              <div
                aria-selected={index === autocompleteSelectionIndex}
                className={`enodios-autocomplete-item ${index === autocompleteSelectionIndex ? "selected" : ""}`}
                key={suggestion.id}
                onClick={() => {
                  onSelectAutocomplete(suggestion);
                }}
                role="option"
              >
                <span className="enodios-autocomplete-icon">
                  {suggestion.type === "folder"
                    ? "📁"
                    : suggestion.type === "citation"
                      ? "🎓"
                      : "📄"}
                </span>
                <span className="enodios-autocomplete-text">
                  <strong>{suggestion.text}</strong>
                  <span className="enodios-autocomplete-desc">
                    {suggestion.type === "folder"
                      ? "Folder"
                      : suggestion.type === "citation"
                        ? "Citation"
                        : "Note"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

interface DiffLine {
  line: string;
  type: "added" | "removed" | "unchanged";
}

interface PendingChangesPanelProps {
  changes: PendingFileChange[];
  onApprove: (changeId: string, contentOverride?: string) => void;
  onApproveAll: () => void;
  onClearResolved: () => void;
  onReject: (changeId: string) => void;
  onRejectAll: () => void;
}

function computeDiffLines(original: string, updated: string): DiffLine[] {
  const origLines = original.split(/\r?\n/);
  const newLines = updated.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oi = 0;
  let ni = 0;

  while (oi < origLines.length || ni < newLines.length) {
    if (oi >= origLines.length) {
      result.push({ line: newLines[ni]!, type: "added" });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ line: origLines[oi]!, type: "removed" });
      oi++;
    } else if (origLines[oi] === newLines[ni]) {
      result.push({ line: origLines[oi]!, type: "unchanged" });
      oi++;
      ni++;
    } else {
      // Simple heuristic: if next original matches next new, this new is an addition
      if (ni + 1 < newLines.length && origLines[oi] === newLines[ni + 1]) {
        result.push({ line: newLines[ni]!, type: "added" });
        ni++;
      } else if (
        oi + 1 < origLines.length &&
        origLines[oi + 1] === newLines[ni]
      ) {
        result.push({ line: origLines[oi]!, type: "removed" });
        oi++;
      } else {
        // Treat as replacement: remove old, add new
        result.push({ line: origLines[oi]!, type: "removed" });
        result.push({ line: newLines[ni]!, type: "added" });
        oi++;
        ni++;
      }
    }
  }

  return result;
}

const PendingChangesPanel = memo(
  ({
    changes,
    onApprove,
    onApproveAll,
    onClearResolved,
    onReject,
    onRejectAll
  }: PendingChangesPanelProps): ReactElement => {
    const [expandedId, setExpandedId] = useState<null | string>(null);
    const [selectedLines, setSelectedLines] = useState<
      Map<string, Set<number>>
    >(new Map());

    const pendingCount = changes.filter((c) => c.status === "pending").length;
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

    const getPartialContent = (
      change: PendingFileChange,
      selected: Set<number>
    ): string => {
      const diffLines =
        change.diffSnapshot ??
        computeDiffLines(change.originalContent, change.newContent ?? "");
      const result: string[] = [];
      for (let i = 0; i < diffLines.length; i++) {
        const dl = diffLines[i]!;
        const isSelected = selected.has(i);
        if (dl.type === "unchanged") {
          result.push(dl.line);
        } else if (dl.type === "added" && isSelected) {
          result.push(dl.line);
        } else if (dl.type === "removed" && !isSelected) {
          result.push(dl.line);
        }
      }
      return result.join("\n");
    };

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const isModifier = e.ctrlKey || e.metaKey;

        if (isModifier && e.shiftKey && e.key.toLowerCase() === "a") {
          e.preventDefault();
          onApproveAll();
        }

        if (isModifier && e.shiftKey && e.key.toLowerCase() === "r") {
          e.preventDefault();
          onRejectAll();
        }

        if (expandedId) {
          if (isModifier && e.key === "Enter") {
            e.preventDefault();
            const target = changes.find((c) => c.id === expandedId);
            if (target && target.status === "pending") {
              const selected = selectedLines.get(expandedId);
              if (selected && selected.size > 0) {
                onApprove(expandedId, getPartialContent(target, selected));
              } else {
                onApprove(expandedId);
              }
            }
          }

          if (e.key === "Escape") {
            e.preventDefault();
            onReject(expandedId);
          }
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [
      expandedId,
      changes,
      selectedLines,
      onApprove,
      onApproveAll,
      onReject,
      onRejectAll
    ]);

    return (
      <div className="enodios-pending-changes">
        <div className="enodios-pending-changes-header">
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span>
              File Changes ({pendingCount} pending
              {resolvedCount > 0 ? `, ${resolvedCount} resolved` : ""})
            </span>
            <span style={{ fontSize: "0.75em", color: "var(--text-muted)" }}>
              Shortcuts: ⌘⇧A (Approve All) • ⌘⇧R (Reject All)
            </span>
          </div>
          <div className="enodios-pending-changes-actions">
            {pendingCount > 1 && (
              <>
                <button
                  className="enodios-btn-approve"
                  onClick={onApproveAll}
                  title="Shortcut: ⌘⇧A"
                  type="button"
                >
                  Approve All
                </button>
                <button
                  className="enodios-btn-reject"
                  onClick={onRejectAll}
                  title="Shortcut: ⌘⇧R"
                  type="button"
                >
                  Reject All
                </button>
              </>
            )}
            {resolvedCount > 0 && (
              <button
                className="enodios-icon-btn"
                onClick={onClearResolved}
                title="Clear resolved"
                type="button"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {changes.map((change) => {
          const isExpanded = expandedId === change.id;
          const diffLines =
            change.diffSnapshot ??
            computeDiffLines(change.originalContent, change.newContent ?? "");
          const selected = selectedLines.get(change.id) ?? new Set();
          const hasSelections = selected.size > 0;
          return (
            <div
              className={`enodios-pending-change enodios-change-${change.status}`}
              key={change.id}
            >
              <div
                className="enodios-pending-change-summary"
                onClick={() => {
                  setExpandedId(isExpanded ? null : change.id);
                }}
                role="button"
                tabIndex={0}
              >
                <span className="enodios-pending-change-path">
                  {change.path}
                </span>
                <div className="enodios-pending-change-badges">
                  {change.status !== "pending" && (
                    <span
                      className={`enodios-pending-change-badge enodios-badge-${change.status}`}
                    >
                      {change.status}
                    </span>
                  )}
                  <span
                    className={`enodios-pending-change-badge enodios-badge-${change.action}`}
                  >
                    {change.action}
                  </span>
                  <button
                    className="enodios-icon-btn"
                    draggable
                    onClick={(e) => {
                      e.stopPropagation();
                      const text =
                        `--- a/${change.path}\n+++ b/${change.path}\n` +
                        diffLines
                          .map(
                            (dl) =>
                              `${dl.type === "added" ? "+" : dl.type === "removed" ? "-" : " "}${dl.line}`
                          )
                          .join("\n");
                      navigator.clipboard
                        .writeText(text)
                        .then(() => {
                          new Notice("Copied diff to clipboard");
                        })
                        .catch(() => {});
                    }}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      const text =
                        `--- a/${change.path}\n+++ b/${change.path}\n` +
                        diffLines
                          .map(
                            (dl) =>
                              `${dl.type === "added" ? "+" : dl.type === "removed" ? "-" : " "}${dl.line}`
                          )
                          .join("\n");
                      e.dataTransfer.setData("text/plain", text);
                    }}
                    title="Copy or Drag Diff"
                    type="button"
                  >
                    <svg
                      fill="none"
                      height="12"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      width="12"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="enodios-pending-change-diff">
                  <div className="enodios-diff-view">
                    {diffLines.map((dl, idx) => {
                      const isSelected = selected.has(idx);
                      const isToggleable =
                        dl.type === "added" || dl.type === "removed";
                      return (
                        <div
                          className={`enodios-diff-line enodios-diff-${dl.type} ${isSelected ? "enodios-diff-selected" : ""}`}
                          key={idx}
                        >
                          {isToggleable && change.status === "pending" && (
                            <input
                              checked={isSelected}
                              className="enodios-diff-checkbox"
                              onChange={() => {
                                toggleLine(change.id, idx);
                              }}
                              title={
                                isSelected
                                  ? "Include this change"
                                  : "Exclude this change"
                              }
                              type="checkbox"
                            />
                          )}
                          <span className="enodios-diff-marker">
                            {dl.type === "added"
                              ? "+"
                              : dl.type === "removed"
                                ? "-"
                                : " "}
                          </span>
                          <span
                            className="enodios-diff-text"
                            dangerouslySetInnerHTML={{
                              __html: highlightLine(dl.line, change.path)
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {change.status === "pending" && (
                    <div className="enodios-pending-change-actions">
                      <button
                        className="enodios-btn-approve"
                        onClick={() => {
                          if (hasSelections) {
                            const partial = getPartialContent(change, selected);
                            onApprove(change.id, partial);
                          } else {
                            onApprove(change.id);
                          }
                        }}
                        title="Shortcut: ⌘Enter"
                        type="button"
                      >
                        {hasSelections ? "Approve Selected" : "Approve All"}
                      </button>
                      <button
                        className="enodios-btn-reject"
                        onClick={() => {
                          onReject(change.id);
                        }}
                        title="Shortcut: Esc"
                        type="button"
                      >
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
  }
);

// --- Permission Request Components ---

interface PendingPermissionsPanelProps {
  onApprove: (permissionId: string, optionId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  permissions: PendingPermission[];
}

const TOOL_KIND_ICONS: Record<string, string> = {
  delete: "🗑️",
  edit: "✏️",
  execute: "▶️",
  fetch: "🌐",
  move: "📦",
  other: "🔧",
  read: "📖",
  search: "🔍",
  switch_mode: "🔄",
  think: "💭"
};

const TOOL_KIND_LABELS: Record<string, string> = {
  delete: "Delete",
  edit: "Edit",
  execute: "Execute",
  fetch: "Fetch",
  move: "Move",
  other: "Other",
  read: "Read",
  search: "Search",
  switch_mode: "Switch Mode",
  think: "Think"
};

const PendingPermissionsPanel = memo(
  ({
    onApprove,
    onApproveAll,
    onRejectAll,
    permissions
  }: PendingPermissionsPanelProps): ReactElement => {
    return (
      <div className="enodios-pending-permissions">
        <div className="enodios-pending-permissions-header">
          <span className="enodios-pending-permissions-title">
            <span className="enodios-pending-permissions-icon">🔒</span>
            Permission Requests ({permissions.length})
          </span>
          {permissions.length > 1 && (
            <div className="enodios-pending-permissions-actions">
              <button
                className="enodios-btn-approve"
                onClick={onApproveAll}
                type="button"
              >
                Approve All
              </button>
              <button
                className="enodios-btn-reject"
                onClick={onRejectAll}
                type="button"
              >
                Reject All
              </button>
            </div>
          )}
        </div>
        {permissions.map((permission) => {
          // Extract tool info from the ACP permission request
          const toolCall = (
            permission.params as unknown as Record<string, unknown>
          )["toolCall"] as Record<string, unknown> | undefined;
          const toolTitle = String(toolCall?.["title"] || "");
          const toolKind = String(toolCall?.["kind"] || "other");
          const rawInput = toolCall?.["rawInput"];
          const locations = toolCall?.["locations"] as
            | Array<Record<string, unknown>>
            | undefined;
          const toolCallContent = toolCall?.["content"] as
            | Array<Record<string, unknown>>
            | undefined;

          let parsedInput: Record<string, unknown> | undefined = undefined;
          if (typeof rawInput === "string") {
            try {
              const parsed = JSON.parse(rawInput);
              if (typeof parsed === "object" && parsed !== null) {
                parsedInput = parsed as Record<string, unknown>;
              }
            } catch {
              // Not JSON
            }
          } else if (typeof rawInput === "object" && rawInput !== null) {
            parsedInput = rawInput as Record<string, unknown>;
          }

          let patchContent: string | null = null;
          if (toolCallContent && Array.isArray(toolCallContent)) {
            const diffBlock = toolCallContent.find((c) => c["type"] === "diff");
            if (diffBlock) {
              const oldText =
                typeof diffBlock["oldText"] === "string"
                  ? diffBlock["oldText"]
                  : "";
              const newText =
                typeof diffBlock["newText"] === "string"
                  ? diffBlock["newText"]
                  : "";
              const lines = computeDiffLines(oldText, newText);
              const out: string[] = [];
              for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                if (!l) continue;
                if (l.type !== "unchanged") {
                  out.push((l.type === "added" ? "+ " : "- ") + l.line);
                } else {
                  let nearChange = false;
                  for (
                    let j = Math.max(0, i - 3);
                    j <= Math.min(lines.length - 1, i + 3);
                    j++
                  ) {
                    const lj = lines[j];
                    if (lj && lj.type !== "unchanged") {
                      nearChange = true;
                      break;
                    }
                  }
                  if (nearChange) {
                    out.push("  " + l.line);
                  } else if (out.length > 0 && out[out.length - 1] !== "...") {
                    out.push("...");
                  }
                }
              }
              patchContent = out.join("\n");
            }
          }

          if (!patchContent && parsedInput) {
            const possiblePatch =
              parsedInput["patch"] ||
              parsedInput["diff"] ||
              parsedInput["content"];
            if (typeof possiblePatch === "string") {
              patchContent = possiblePatch;
            }
          }

          // Build a human-readable description of what the tool wants to do
          const toolName =
            toolTitle || TOOL_KIND_LABELS[toolKind] || "Unknown tool";
          const toolIcon = TOOL_KIND_ICONS[toolKind] || "🔧";

          let actionDesc = "";
          if (parsedInput) {
            const path =
              parsedInput["path"] ||
              parsedInput["file"] ||
              parsedInput["filename"];
            const command = parsedInput["command"] || parsedInput["cmd"];
            const query = parsedInput["query"] || parsedInput["search"];
            const url = parsedInput["url"] || parsedInput["uri"];

            if (path) {
              actionDesc = `Target: \`${String(path)}\``;
            } else if (command) {
              actionDesc = `Command: \`${String(command)}\``;
            } else if (query) {
              actionDesc = `Query: "${String(query)}"`;
            } else if (url) {
              actionDesc = `URL: ${String(url)}`;
            } else {
              // Fallback: show all keys except patch/content if we are rendering it
              const keys = Object.keys(parsedInput)
                .filter((k) => k !== "patch" && k !== "diff" && k !== "content")
                .slice(0, 3);
              if (keys.length > 0) {
                actionDesc = keys
                  .map(
                    (k) =>
                      `${k}: ${(JSON.stringify(parsedInput![k]) ?? "").slice(0, 50)}`
                  )
                  .join(", ");
              }
            }
          } else if (typeof rawInput === "string") {
            actionDesc = rawInput;
          }

          // Show affected locations if available
          const locationPaths =
            locations
              ?.map((l) => String(l["path"] || l["uri"] || ""))
              .filter(Boolean) || [];

          return (
            <div className="enodios-pending-permission" key={permission.id}>
              <div className="enodios-pending-permission-header">
                <span className="enodios-pending-permission-tool">
                  <span className="enodios-pending-permission-tool-icon">
                    {toolIcon}
                  </span>
                  <strong>{toolName}</strong>
                  <span className="enodios-pending-permission-kind">
                    ({toolKind})
                  </span>
                </span>
              </div>

              <div className="enodios-pending-permission-details">
                {actionDesc && (
                  <div className="enodios-pending-permission-action">
                    <span className="enodios-pending-permission-label">
                      Action:
                    </span>
                    <code className="enodios-pending-permission-value">
                      {actionDesc}
                    </code>
                  </div>
                )}
                {locationPaths.length > 0 && (
                  <div className="enodios-pending-permission-locations">
                    <span className="enodios-pending-permission-label">
                      Affects:
                    </span>
                    <span className="enodios-pending-permission-value">
                      {locationPaths.map((p, i) => (
                        <span
                          className="enodios-pending-permission-path"
                          key={i}
                        >
                          {p}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {patchContent && (
                  <div className="enodios-pending-permission-patch">
                    <span className="enodios-pending-permission-label">
                      Patch Preview:
                    </span>
                    <pre className="enodios-pending-permission-diff">
                      <code className="language-diff">{patchContent}</code>
                    </pre>
                  </div>
                )}
              </div>

              <div className="enodios-pending-permission-options">
                {permission.params.options.map((option) => (
                  <button
                    className={`enodios-permission-option enodios-permission-option--${option.kind}`}
                    key={option.optionId}
                    onClick={() => {
                      onApprove(permission.id, option.optionId);
                    }}
                    title={
                      option.kind === "allow_always" ||
                      option.kind === "allow_once" ||
                      option.kind === "reject_once" ||
                      option.kind === "reject_always"
                        ? option.name
                        : option.name
                    }
                    type="button"
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

// --- Token Usage Footer ---

interface TokenUsageFooterProps {
  visible: boolean;
}

const TokenUsageFooter = memo(
  ({ visible }: TokenUsageFooterProps): ReactElement => {
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

      window.addEventListener(
        "enodios-usage-update",
        handleUsageUpdate as EventListener
      );
      return () => {
        window.removeEventListener(
          "enodios-usage-update",
          handleUsageUpdate as EventListener
        );
      };
    }, []);

    if (!visible || !isVisible) {
      return <></>;
    }

    return (
      <div className="enodios-token-footer">
        <span className="enodios-token-stat" title="Input tokens">
          <svg
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>{" "}
          {usage.inputTokens.toLocaleString()} in
        </span>
        <span className="enodios-token-stat" title="Output tokens">
          <svg
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>{" "}
          {usage.outputTokens.toLocaleString()} out
        </span>
        <span className="enodios-token-stat" title="Total tokens">
          {usage.totalTokens.toLocaleString()} total
        </span>
        <span
          className="enodios-token-stat enodios-token-cost"
          title="Estimated cost (USD)"
        >
          ~${usage.estimatedCost.toFixed(4)}
        </span>
      </div>
    );
  }
);

// --- Onboarding Panel ---

interface OnboardingPanelProps {
  agentName: string;
  hasSeenOnboarding: boolean;
  onDismiss: () => void;
  templates: ChatTemplate[];
  onLoadTemplate: (prompt: string) => void;
}

const OnboardingPanel = memo(
  ({
    agentName,
    hasSeenOnboarding,
    onDismiss,
    templates,
    onLoadTemplate
  }: OnboardingPanelProps): ReactElement => {
    const [isVisible, setIsVisible] = useState(!hasSeenOnboarding);

    useEffect(() => {
      if (!isVisible) {
        return;
      }
      const handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === "Escape") {
          setIsVisible(false);
          onDismiss();
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isVisible, onDismiss]);

    if (!isVisible) {
      return (
        <div
          className="enodios-empty-state-container"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            padding: "30px 20px",
            alignItems: "center",
            height: "100%",
            justifyContent: "center"
          }}
        >
          <div
            className="enodios-empty-state"
            style={{
              fontSize: "1.2em",
              fontWeight: "bold",
              color: "var(--text-muted)"
            }}
          >
            Start a conversation with {agentName}
          </div>

          {templates.length > 0 && (
            <div style={{ width: "100%", maxWidth: "400px", margin: "0 auto" }}>
              <div
                style={{
                  fontSize: "0.85em",
                  color: "var(--text-muted)",
                  marginBottom: "12px",
                  textAlign: "center",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: "600"
                }}
              >
                Conversation Starters
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  justifyContent: "center",
                  alignItems: "stretch",
                  width: "100%"
                }}
              >
                {templates.map((tpl) => (
                  <button
                    className="btn"
                    key={tpl.id}
                    onClick={() => onLoadTemplate(tpl.prompt)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--text-accent)";
                      e.currentTarget.style.backgroundColor =
                        "var(--background-modifier-hover)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border-color)";
                      e.currentTarget.style.backgroundColor =
                        "var(--background-secondary)";
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "16px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--background-secondary)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      textAlign: "center",
                      gap: "8px",
                      height: "100%",
                      width: "100%",
                      margin: 0,
                      boxSizing: "border-box"
                    }}
                    title={tpl.description}
                    type="button"
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-accent)",
                        marginBottom: "4px"
                      }}
                    >
                      <StarterIcon icon={tpl.icon} id={tpl.id} />
                    </span>
                    <span
                      style={{
                        fontSize: "0.85em",
                        fontWeight: "600",
                        color: "var(--text-normal)"
                      }}
                    >
                      {tpl.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="enodios-onboarding">
        <div className="enodios-onboarding-header">
          <span>👋 Welcome to {agentName}</span>
          <button
            className="enodios-icon-btn"
            onClick={() => {
              setIsVisible(false);
              onDismiss();
            }}
            title="Dismiss"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="enodios-onboarding-content">
          <p>
            <strong>{agentName}</strong> is your AI assistant inside Obsidian.
            Here's how to get started:
          </p>
          <ul>
            <li>
              <strong>💬 Chat:</strong> Type a message and press Enter to send.
            </li>
            <li>
              <strong>📎 Context:</strong> Click the @ button to add the current
              note or selection to the conversation.
            </li>
            <li>
              <strong>⚡ Slash Commands:</strong> Type <code>/</code> to see
              available commands like <code>/clear</code>, <code>/persona</code>
              , <code>/search</code>.
            </li>
            <li>
              <strong>🔧 Tools:</strong> The agent can read files, write files,
              and run terminal commands (with your approval).
            </li>
            <li>
              <strong>🔍 Search:</strong> Press <kbd>Cmd+F</kbd> to search
              through messages.
            </li>
            <li>
              <strong>⚙️ Settings:</strong> Configure connection mode (ACP/API),
              personas, and security in the settings tab.
            </li>
          </ul>
          <p className="enodios-onboarding-security">
            🔒 <strong>Security Note:</strong> Terminal access is disabled by
            default. File changes require your explicit approval via the diff
            viewer.
          </p>
        </div>
        <button
          className="enodios-btn-approve"
          onClick={() => {
            setIsVisible(false);
            onDismiss();
          }}
          type="button"
        >
          Got it!
        </button>
      </div>
    );
  }
);
