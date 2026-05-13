import { ItemView, MarkdownView } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { HermesAPI } from '../HermesAPI.ts';
import type { HermesMessage, HermesSession } from '../HermesAPI.ts';

export const HERMES_CHAT_VIEW_TYPE = 'hermes-chat-view';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export class HermesChatView extends ItemView {
  private root: ReturnType<typeof createRoot> | null = null;
  private hermesAPI!: HermesAPI;

  private currentSession: HermesSession | null = null;
  private sessionLoaded: boolean = false;

  constructor(leaf: any, private plugin: any) {
    super(leaf);
  }

  public getCurrentSession(): HermesSession | null {
    return this.currentSession;
  }

  public getPlugin(): any {
    return this.plugin;
  }

  public getSessionLoaded(): boolean {
    return this.sessionLoaded;
  }

  public setSessionLoaded(value: boolean): void {
    this.sessionLoaded = value;
  }

  public getSettings(): any {
    return this.plugin.settings;
  }

  public override getDisplayText(): string {
    return 'Hermes Chat';
  }

  public override getViewType(): string {
    return HERMES_CHAT_VIEW_TYPE;
  }

  public override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.hermesAPI = new HermesAPI(this.plugin);
    this.root = createRoot(this.contentEl);
    this.root.render(<HermesChatViewComponent view={this} />);
    
    // Load existing sessions
    await this.loadSessions();
  }

  public override async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  public async loadSessions(): Promise<void> {
    const sessions = await this.hermesAPI.getSessions();
    if (sessions.length > 0) {
      // Load the most recent session
      const sortedSessions = sessions.filter(s => s.updated_at !== undefined && s.updated_at !== null).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
      if (sortedSessions.length > 0 && sortedSessions[0].id) {
        await this.loadSession(sortedSessions[0].id);
      }
    } else {
      // Create a new session
      await this.createSession();
    }
  }

  public async createSession(): Promise<void> {
    const session = await this.hermesAPI.createSession();
    if (session) {
      this.currentSession = session;
      this.sessionLoaded = true;
      // TODO: Trigger re-render with new session
    }
  }

  public async loadSession(sessionId: string): Promise<void> {
    const session = await this.hermesAPI.getSession(sessionId);
    if (session) {
      this.currentSession = session;
      this.sessionLoaded = true;
      // TODO: Trigger re-render with loaded session
    }
  }

  public async saveSession(session: HermesSession): Promise<void> {
    if (session.id) {
      await this.hermesAPI.updateSession(session.id, {
        topic: session.topic,
        messages: session.messages,
        updated_at: Date.now()
      });
    }
  }

  public async sendMessage(prompt: string, context?: string): Promise<void> {
    if (!this.currentSession) {
      await this.createSession();
      if (!this.currentSession) return;
    }

    // Add user message to current session
    const userMessage: HermesMessage = {
      role: 'user',
      content: prompt
    };

    this.currentSession.messages.push(userMessage);
    this.currentSession.updated_at = Date.now();

    // Send to Hermes API
    const response = await this.hermesAPI.sendMessage(
      this.currentSession.id,
      prompt,
      context,
      this.plugin.settings.hermesDefaultModel
    );

    if (response && response.choices && response.choices.length > 0 && response.choices[0].message) {
      const assistantMessage: HermesMessage = response.choices[0].message;
      
      // Add assistant response to session
      this.currentSession.messages.push(assistantMessage);
      this.currentSession.updated_at = Date.now();
      
      // Save session
      await this.saveSession(this.currentSession);
    }
  }
}

interface HermesChatViewComponentProps {
  view: HermesChatView;
}

function HermesChatViewComponent({ view }: HermesChatViewComponentProps): ReactElement {
  const [topic] = useState<string>(view.getCurrentSession()?.topic || 'New Conversation');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [contextMode, setContextMode] = useState<'selection' | 'editor'>('editor');

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load messages from current session
  useEffect(() => {
    const currentSession = view.getCurrentSession();
    if (currentSession && currentSession.messages) {
      const chatMessages: ChatMessage[] = currentSession.messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: msg.role === 'user' ? Date.now() : Date.now() // TODO: Use actual timestamp from session
      }));
      setMessages(chatMessages);
    }
  }, [view.getCurrentSession()]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current && view.getSettings().chatAutoScroll) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, view.getSettings().chatAutoScroll]);

  // Load existing session if available
  useEffect(() => {
    if (!view.getSessionLoaded() && !view.getCurrentSession()) {
      view.loadSessions();
    }
  }, []);

  const handleSend = async (): Promise<void> => {
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Get context based on mode
    let context = '';
    if (contextMode === 'selection') {
      context = await getContextFromSelection(view);
    } else {
      context = await getContextFromEditor(view);
    }

    // Send to Hermes API
    await view.sendMessage(input, context);
    setIsTyping(false);

    // Refresh messages after API call
    const currentSession = view.getCurrentSession();
    if (currentSession && currentSession.messages) {
      const chatMessages: ChatMessage[] = currentSession.messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: msg.role === 'user' ? Date.now() : Date.now()
      }));
      setMessages(chatMessages);
    }
  };

  const handleContextClick = async (): Promise<void> => {
    // Show context options
    const mode = await showContextOptions();
    setContextMode(mode);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleWikilinkInsert = (): void => {
    // Insert wikilink template
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const text = input.value;
      input.value = text.substring(0, start) + '[[ ]]';
      input.selectionStart = start + 2;
      input.selectionEnd = end + 2;
      input.focus();
    }
  };

  const handleAtSymbol = (): void => {
    // Trigger Obsidian's link selector
    // TODO: Implement Obsidian link selector integration
  };

  return (
    <div className="hermes-chat-container">
      {/* Title Bar */}
      {view.getSettings().chatShowTitle && (
        <div className="hermes-chat-title">
          <h2>Hermes Agent</h2>
        </div>
      )}

      {/* Topic */}
      {view.getSettings().chatShowTopic && (
        <div className="hermes-chat-topic">
          <span>{topic}</span>
        </div>
      )}

      {/* Chat Content */}
      <div className="hermes-chat-content" ref={chatContainerRef}>
        {messages.map((msg, index) => (
          <div key={index} className={`hermes-message hermes-${msg.role}`}>
            <div className="hermes-message-header">
              <span className="hermes-role">{msg.role === 'user' ? 'You' : 'Hermes'}</span>
              <span className="hermes-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="hermes-message-content">
              {/* Render markdown content */}
              <div
                className="hermes-markdown"
                ref={(el) => {
                  if (el && view.getSettings().chatMarkdownRender) {
                    // Render markdown using Obsidian's renderer
                    // TODO: Implement markdown rendering
                  }
                }}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="hermes-message hermes-assistant hermes-typing">
            <div className="hermes-message-content">
              <span className="hermes-typing-indicator">...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="hermes-input-area">
        <div className="hermes-input-toolbar">
          <button
            className="hermes-toolbar-btn hermes-context-btn"
            onClick={handleContextClick}
            title="Add context from editor"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M16 13H8" />
              <path d="M16 17H8" />
              <path d="M10 9H8" />
            </svg>
          </button>
          <button
            className="hermes-toolbar-btn hermes-wikilink-btn"
            onClick={handleWikilinkInsert}
            title="Insert wikilink"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-3 3a5 5 0 0 0-5.48 5.48" />
              <path d="M14 13a5 5 0 0 1-7.54-.54l-3-3a5 5 0 0 1 7.07-7.07l3 3a5 5 0 0 1 5.48 5.48" />
            </svg>
          </button>
          <button
            className="hermes-toolbar-btn hermes-at-btn"
            onClick={handleAtSymbol}
            title="Add context with @"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M16 16s-3-2-7-5" />
              <path d="M12 12v3" />
              <path d="M12 19a3 3 0 0 0 3-3" />
            </svg>
          </button>
        </div>
        <textarea
          ref={inputRef}
          className="hermes-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type your message... (Shift+Enter for new line)"
          rows={3}
        />
        <div className="hermes-input-footer">
          <button
            className="hermes-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// Helper functions
async function getContextFromSelection(view: any): Promise<string> {
  // Get selected text from active editor
  const activeView = view.getPlugin().app.workspace.getActiveViewOfType(MarkdownView);
  if (activeView) {
    const editor = activeView.editor;
    const selection = editor.getSelection();
    if (selection) {
      return selection;
    }
  }
  return '';
}

async function getContextFromEditor(view: any): Promise<string> {
  // Get entire editor content
  const activeView = view.getPlugin().app.workspace.getActiveViewOfType(MarkdownView);
  if (activeView) {
    const editor = activeView.editor;
    return editor.getValue();
  }
  return '';
}

async function showContextOptions(): Promise<'selection' | 'editor'> {
  // Show context options modal
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'hermes-context-modal';

    const editorBtn = document.createElement('button');
    editorBtn.textContent = 'Current Editor';
    editorBtn.onclick = () => {
      modal.remove();
      resolve('editor');
    };

    const selectionBtn = document.createElement('button');
    selectionBtn.textContent = 'Selected Text';
    selectionBtn.onclick = () => {
      modal.remove();
      resolve('selection');
    };

    modal.appendChild(editorBtn);
    modal.appendChild(selectionBtn);
    document.body.appendChild(modal);
  });
}
