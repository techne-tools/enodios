import { ItemView } from 'obsidian';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { useRef, useState, useEffect } from 'react';
import { HermesAPI } from '../HermesAPI.ts';

export const HERMES_CHAT_VIEW_TYPE = 'hermes-chat-view';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export class HermesChatView extends ItemView {
  private root: ReturnType<typeof createRoot> | null = null;
  private hermesAPI!: HermesAPI;
  private previousResponseId: string | null = null;

  constructor(leaf: any, private plugin: any) {
    super(leaf);
  }

  public getPlugin(): any {
    return this.plugin;
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
    
    // Check connection on open
    await this.checkConnection();
  }

  public override async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  private async checkConnection(): Promise<void> {
    const isConnected = await this.hermesAPI.checkConnection();
    if (isConnected) {
      console.log('Hermes API: Connected successfully');
    } else {
      console.warn('Hermes API: Connection failed. Check settings.');
    }
  }

  public async sendMessage(prompt: string, onAssistantResponse: (content: string) => void): Promise<void> {
    // Send to Hermes API using Responses API for server-side session management
    const response = await this.hermesAPI.sendMessageWithResponseAPI(
      prompt,
      this.previousResponseId,
      'obsidian-chat',
      undefined,
      this.plugin.settings.hermesAgentName
    );

    if (response && response.output && response.output.length > 0) {
      // Find the assistant's response
      const assistantOutput = response.output.find(out => 
        out.type === 'message' && out.role === 'assistant'
      );
      
      if (assistantOutput && assistantOutput.content) {
        // Store response ID for next turn
        this.previousResponseId = response.id;
        
        // Extract text content from the response
        const textContent = this.extractTextContent(assistantOutput.content);
        console.log('Hermes response:', textContent);
        
        // Call the callback to update the UI
        onAssistantResponse(textContent);
      }
    }
  }

  private extractTextContent(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((c: { text?: string; value?: string }) => c.text || c.value || '').join('\n');
    }
    return String(content);
  }
}

interface HermesChatViewComponentProps {
  view: HermesChatView;
}

function HermesChatViewComponent({ view }: HermesChatViewComponentProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);

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

    await view.sendMessage(input, (assistantContent) => {
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="hermes-chat-container">
      <div className="hermes-chat-header">
        <div className="hermes-chat-header-left">
          <span className="hermes-chat-agent-name">{view.getSettings().chatAgentName || 'Hermes'}</span>
        </div>
        <div className="hermes-chat-header-right">
          <button className="hermes-icon-btn" title="New Chat">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
          <button className="hermes-icon-btn" title="Settings" onClick={() => view.getPlugin().openSettings()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

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
              <div className="hermes-markdown">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="hermes-message hermes-assistant">
            <div className="hermes-message-header">
              <span className="hermes-role">Hermes</span>
              <span className="hermes-typing">Typing...</span>
            </div>
          </div>
        )}
      </div>

      <div className="hermes-input-wrapper">
        <div className="hermes-input-container">
          <textarea
            ref={(el) => {
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize textarea
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Message Hermes..."
            rows={1}
            className="hermes-input"
          />
          <div className="hermes-input-bottom">
            <div className="hermes-input-left">
              <button className="hermes-context-btn" title="Add Context">
                <span>@</span>
              </button>
              <div className="hermes-context-list">
                {/* Context chips will be rendered here */}
              </div>
            </div>
            <div className="hermes-input-right">
              <button className="hermes-icon-btn" title="Add Image">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </button>
              <button className="hermes-send-btn" onClick={handleSend} disabled={isTyping || !input.trim()} title="Send">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
