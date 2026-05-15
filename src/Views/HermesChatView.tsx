import type { ReactElement } from 'react';

import {
 ItemView,
MarkdownView
} from 'obsidian';
import {
 useEffect,
useRef,
useState
} from 'react';
import { createRoot } from 'react-dom/client';

import { HermesAPI } from '../HermesAPI.ts';

export const HERMES_CHAT_VIEW_TYPE = 'hermes-chat-view';

export interface ChatMessage {
  content: string;
  role: 'assistant' | 'system' | 'user';
  timestamp: number;
}

interface HermesChatViewComponentProps {
  view: HermesChatView;
}

/**
 * Renders markdown content using Obsidian's native markdown renderer.
 * Supports Obsidian Flavored Markdown (OFM) including:
 * - Callouts, code blocks, wikilinks
 * - Embeds, tables, lists
 * - MathJax, highlights, etc.
 */
interface MarkdownRendererProps {
  content: string;
  view: HermesChatView;
}

export class HermesChatView extends ItemView {
  private hermesAPI!: HermesAPI;
  private previousResponseId: null | string = null;
  private root: null | ReturnType<typeof createRoot> = null;

  constructor(leaf: any, private plugin: any) {
    super(leaf);
  }

  public override getDisplayText(): string {
    return 'Hermes Chat';
  }

  public getPlugin(): any {
    return this.plugin;
  }

  public getSettings(): any {
    return this.plugin.settings;
  }

  public override getViewType(): string {
    return HERMES_CHAT_VIEW_TYPE;
  }

  public override async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  public override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.hermesAPI = new HermesAPI(this.plugin);
    this.root = createRoot(this.contentEl);
    this.root.render(<HermesChatViewComponent view={this} />);

    // Check connection on open
    await this.checkConnection();
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
      const assistantOutput = response.output.find((out) =>
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

  private async checkConnection(): Promise<void> {
    const isConnected = await this.hermesAPI.checkConnection();
    if (isConnected) {
      console.log('Hermes API: Connected successfully');
    } else {
      console.warn('Hermes API: Connection failed. Check settings.');
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

function HermesChatViewComponent({ view }: HermesChatViewComponentProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [contextItems, setContextItems] = useState<{ id: string; text: string; type: 'folder' | 'note' | 'selection' }[]>([]);
  const [autocompleteQuery, setAutocompleteQuery] = useState<string>('');
  const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<{ id: string; text: string; type: 'folder' | 'note' }[]>([]);
  const [autocompletePosition, setAutocompletePosition] = useState<{ left: number; bottom: number; width?: number } | null>(null);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState<boolean>(false);
  const [autocompleteSelectionIndex, setAutocompleteSelectionIndex] = useState<number>(0);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async (): Promise<void> => {
    if (!input.trim()) { return; }

    const userMessage: ChatMessage = {
      content: input,
      role: 'user',
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    await view.sendMessage(input, (assistantContent) => {
      const assistantMessage: ChatMessage = {
        content: assistantContent,
        role: 'assistant',
        timestamp: Date.now()
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // If autocomplete is open, don't handle Enter - let autocomplete handle it
    if (isAutocompleteOpen) {
      return;
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleContextClick = (): void => {
    console.log('Context button clicked');
    console.log('Settings:', view.getSettings());

    // Get the active file
    const activeFile = view.getPlugin().app.workspace.getActiveFile();
    console.log('Active file:', activeFile?.path);

    // Try to get the active editor from any markdown view in the workspace
    let selectedText = '';
    let activeEditor = null;

    // Get all views in the workspace
    const allViews = view.getPlugin().app.workspace.getLeavesOfType('markdown');
    console.log('All markdown views:', allViews.length);

    for (const leaf of allViews) {
      const viewType = leaf.view.getViewType();
      console.log('View type:', viewType);

      if (viewType === 'markdown' && leaf.view instanceof MarkdownView) {
        activeEditor = leaf.view.editor;
        console.log('Found markdown editor');
        break;
      }
    }

    if (activeEditor) {
      selectedText = activeEditor.getSelection();
      console.log('Editor selection:', selectedText);
      console.log('Selection length:', selectedText.length);
    }

    // Check if auto-add is enabled
    const autoAddEnabled = view.getSettings().contextEntireNote;
    console.log('Auto-add enabled:', autoAddEnabled);

    if (autoAddEnabled) {
      // Auto-add mode: if text selected, add to context; if no text, do nothing
      if (selectedText && selectedText.length > 0) {
        // Add selection to context with precise deduplication
        const isDuplicate = contextItems.some((item) =>
          item.type === 'selection' && item.text === selectedText
        );

        if (isDuplicate) {
          console.log('Duplicate selection already in context');
          return;
        }

        const newContextItem = {
          id: `selection-${Date.now()}`,
          text: selectedText,
          type: 'selection' as const
        };
        setContextItems((prev) => [...prev, newContextItem]);
        console.log('Added selected text to context (auto-add mode):', selectedText.substring(0, 50));
      } else {
        console.log('No text selected, auto-add mode active - doing nothing');
      }
    } else {
      // Manual mode: '@' button adds current note (if no text) or selection (if text)
      if (selectedText && selectedText.length > 0) {
        // Add selection to context with precise deduplication
        const isDuplicate = contextItems.some((item) =>
          item.type === 'selection' && item.text === selectedText
        );

        if (isDuplicate) {
          console.log('Duplicate selection already in context');
          return;
        }

        const newContextItem = {
          id: `selection-${Date.now()}`,
          text: selectedText,
          type: 'selection' as const
        };
        setContextItems((prev) => [...prev, newContextItem]);
        console.log('Added selected text to context (manual mode):', selectedText.substring(0, 50));
      } else if (activeFile) {
        // Add current note to context with precise deduplication by path
        const isDuplicate = contextItems.some((item) =>
          item.type === 'note' && item.id === `note-${activeFile.path}`
        );

        if (isDuplicate) {
          console.log('Current note already in context');
          return;
        }

        const newContextItem = {
          id: `note-${activeFile.path}`,
          text: activeFile.basename,
          type: 'note' as const
        };
        setContextItems((prev) => [...prev, newContextItem]);
        console.log('Added current note to context (manual mode):', activeFile.path);
      }
    }
  };

  const removeContextItem = (id: string): void => {
    setContextItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Watch for active file changes and update context if auto-add is enabled
  useEffect(() => {
    const currentActiveFile = view.getPlugin().app.workspace.getActiveFile();
    const autoAddEnabled = view.getSettings().contextEntireNote;

    // Only update if auto-add is enabled
    if (currentActiveFile && autoAddEnabled) {
      // Check if the active file has changed (precise deduplication by path)
      const currentNoteItem = contextItems.find((item) => item.type === 'note');

      if (currentNoteItem?.id !== `note-${currentActiveFile.path}`) {
        // Replace the entire context stack with only the new note
        // This clears all previous context items and adds only the current note
        setContextItems([{
          id: `note-${currentActiveFile.path}`,
          text: currentActiveFile.basename,
          type: 'note' as const
        }]);
        console.log('Replaced context stack with new note (auto-add):', currentActiveFile.path);
      }
    } else if (!autoAddEnabled && contextItems.length > 0) {
      // If auto-add is disabled, clear the context stack
      setContextItems([]);
      console.log('Cleared context stack (auto-add disabled)');
    }
  }, [view.getPlugin().app.workspace.getActiveFile()?.path, view.getSettings().contextEntireNote]);

  // Initialize context with current note when view opens (if auto-add is enabled)
  useEffect(() => {
    const autoAddEnabled = view.getSettings().contextEntireNote;
    
    if (autoAddEnabled) {
      const currentActiveFile = view.getPlugin().app.workspace.getActiveFile();
      if (currentActiveFile) {
        // Set initial context with the current note
        setContextItems([{
          id: `note-${currentActiveFile.path}`,
          text: currentActiveFile.basename,
          type: 'note' as const
        }]);
        console.log('Initialized context with current note (view open):', currentActiveFile.path);
      }
    }
  }, []);

  // Autocomplete functionality for braces {} and wikilinks [[...]]
  useEffect(() => {
    // Check if user typed opening brace or [[ in the current input
    if (input.length > 0) {
      const lastChar = input[input.length - 1];
      const lastTwoChars = input.length > 1 ? input.substring(input.length - 2) : '';

      // Check if we just opened autocomplete (typing { or [[)
      const justOpened = (lastChar === '{' && !input.substring(input.length - 2, input.length - 1).endsWith('\\')) ||
                         (lastTwoChars === '[[' && !input.substring(input.length - 3, input.length - 1).endsWith('\\'));

      if (justOpened) {
        // User just typed { or [[ - open autocomplete
        setIsAutocompleteOpen(true);
        setAutocompleteQuery('');
        setAutocompleteSelectionIndex(0);
        console.log('Autocomplete opened for', lastTwoChars === '[[' ? '[[' : '{');
      } else if (isAutocompleteOpen) {
        // Autocomplete is open - extract query after [[ or {
        const lastOpen = Math.max(input.lastIndexOf('[['), input.lastIndexOf('{'));
        if (lastOpen >= 0) {
          const query = input.substring(lastOpen + 2);
          setAutocompleteQuery(query);
          console.log('Autocomplete query updated:', query);
          
          // Reset selection index when typing new query
          if (query.length > 0) {
            setAutocompleteSelectionIndex(0);
          }
        }
      }
    }
  }, [input]);

  // Fetch autocomplete suggestions when query changes
  useEffect(() => {
    console.log('[Autocomplete] Query changed:', autocompleteQuery, 'Length:', autocompleteQuery.length);
    if (autocompleteQuery.length > 0) {
      const fetchSuggestions = async (): Promise<void> => {
        console.log('[Autocomplete] Fetching suggestions for:', autocompleteQuery);
        const vault = view.getPlugin().app.vault;
        const files = vault.getMarkdownFiles();
        console.log('[Autocomplete] Total files in vault:', files.length);
        const queryLower = autocompleteQuery.toLowerCase();

        // Filter files by path
        const matches = files.filter((file: any) =>
          file.path.toLowerCase().includes(queryLower)
          || file.basename.toLowerCase().includes(queryLower)
        );
        console.log('[Autocomplete] Matches found:', matches.length);

        // Get most recent files (last 5 modified)
        const recentFiles = matches
          .map((file: any) => ({
            basename: file.basename,
            mtime: file.stat.mtime,
            path: file.path
          }))
          .sort((a: any, b: any) => b.mtime - a.mtime)
          .slice(0, 5);

        const suggestions = recentFiles.map((file: any) => ({
          id: `note-${file.path}`,
          text: file.path, // Use full path for filesystem paths
          type: 'note' as const
        }));

        // Also add folder suggestions if query contains path separators
        if (autocompleteQuery.includes('/')) {
          const folders = new Set<string>();
          files.forEach((file: any) => {
            const pathParts = file.path.split('/');
            for (let i = 1; i < pathParts.length; i++) {
              const folderPath = pathParts.slice(0, i).join('/');
              if (folderPath.toLowerCase().includes(queryLower)) {
                folders.add(folderPath);
              }
            }
          });

          const folderSuggestions = Array.from(folders)
            .slice(0, 5 - suggestions.length)
            .map((folder: string) => ({
              id: `folder-${folder}`,
              text: folder,
              type: 'folder' as const
            }));

          suggestions.push(...folderSuggestions);
        }

        const finalSuggestions = suggestions.slice(0, 5);
        console.log('[Autocomplete] Final suggestions:', finalSuggestions);
        setAutocompleteSuggestions(finalSuggestions);
      };

      fetchSuggestions();
    } else {
      console.log('[Autocomplete] Clearing suggestions (empty query)');
      setAutocompleteSuggestions([]);
    }
  }, [autocompleteQuery]);

  // Position autocomplete pane above textarea
  useEffect(() => {
    if (isAutocompleteOpen && textareaRef.current) {
      const textarea = textareaRef.current;
      const container = textarea.closest('.hermes-chat-container');
      const inputWrapper = textarea.closest('.hermes-input-wrapper');
      
      // Get input wrapper position relative to viewport
      const inputWrapperRect = inputWrapper?.getBoundingClientRect();
      
      // Get container position relative to viewport
      const containerRect = container?.getBoundingClientRect();
      
      // Calculate position relative to container
      const left = containerRect && inputWrapperRect ? inputWrapperRect.left - containerRect.left : 0;
      // bottom = position of input wrapper top relative to viewport
      // This positions the bottom of autocomplete at the top of input wrapper
      const bottom = inputWrapperRect?.top || 0;
      
      console.log('Autocomplete positioning:', {
        left: left,
        bottom: bottom,
        width: inputWrapperRect?.width
      });
      setAutocompletePosition({
        left: left,
        bottom: bottom,
        width: inputWrapperRect?.width
      });
    }
  }, [isAutocompleteOpen, autocompleteSuggestions.length]);

  return (
    <div className="hermes-chat-container">
      <div className="hermes-chat-header">
        <div className="hermes-chat-header-left">
          <span className="hermes-chat-agent-name">{view.getSettings().chatAgentName || 'Hermes'}</span>
        </div>
        <div className="hermes-chat-header-right">
          <button className="hermes-icon-btn" title="New Chat">
            <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className="hermes-icon-btn" onClick={() => view.getPlugin().openSettings()} title="Settings">
            <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="hermes-chat-content" ref={chatContainerRef}>
        {messages.map((msg, index) => (
          <div className={`hermes-message hermes-${msg.role}`} key={index}>
            <div className="hermes-message-header">
              <span className="hermes-role">{msg.role === 'user' ? 'You' : 'Hermes'}</span>
              <span className="hermes-timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="hermes-message-content">
              <MarkdownRenderer content={msg.content} view={view} />
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
          <div className="hermes-input-left">
            <button
              className="hermes-context-btn"
              onClick={handleContextClick}
              title="Add Context"
            >
              <span>@</span>
            </button>
            <div className="hermes-context-list">
              {contextItems.map((item) => (
                <div className="hermes-context-chip" key={item.id}>
                  <button
                    className="hermes-context-remove"
                    onClick={() => { removeContextItem(item.id); }}
                    title="Remove from context"
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
          </div>
          <textarea
            className="hermes-input"
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);

              // Check if user typed [[ or { to open autocomplete
              if (value.endsWith('[[') || value.endsWith('{')) {
                setIsAutocompleteOpen(true);
                setAutocompleteQuery('');
                setAutocompleteSelectionIndex(0);
              } else if (value.endsWith(']') && value.length > 1 && value[value.length - 2] === ']') {
                setIsAutocompleteOpen(false);
                setAutocompleteQuery('');
                setAutocompleteSuggestions([]);
                setAutocompleteSelectionIndex(0);
              } else if (value.endsWith('}')) {
                setIsAutocompleteOpen(false);
                setAutocompleteQuery('');
                setAutocompleteSuggestions([]);
                setAutocompleteSelectionIndex(0);
              } else if (isAutocompleteOpen) {
                // Extract query after [[ or {
                const lastOpen = Math.max(value.lastIndexOf('[['), value.lastIndexOf('{'));
                if (lastOpen >= 0) {
                  const query = value.substring(lastOpen + 2);
                  setAutocompleteQuery(query);
                  
                  // Reset selection index when typing new query
                  if (query.length > 0) {
                    setAutocompleteSelectionIndex(0);
                  }
                }
              }

              // Auto-resize textarea
              const target = e.target;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              handleInputKeyDown(e);

              // Handle autocomplete selection with arrow keys
              if (isAutocompleteOpen && autocompleteSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setAutocompleteSelectionIndex((prev) => 
                    prev < autocompleteSuggestions.length - 1 ? prev + 1 : 0
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setAutocompleteSelectionIndex((prev) => 
                    prev > 0 ? prev - 1 : autocompleteSuggestions.length - 1
                  );
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  const selected = autocompleteSuggestions[autocompleteSelectionIndex];
                  if (selected) {
                    const value = input;
                    const lastOpen = Math.max(value.lastIndexOf('[['), value.lastIndexOf('{'));
                    if (lastOpen >= 0) {
                      // Get the query that was typed after the opening
                      // For [[, the opening is 2 chars, so query starts at lastOpen + 2
                      // For {, the opening is 1 char, so query starts at lastOpen + 1
                      const queryStart = value[lastOpen] === '[' ? lastOpen + 2 : lastOpen + 1;
                      const query = value.substring(queryStart);
                      
                      // Prefix is just the opening bracket(s)
                      const prefix = value.substring(0, lastOpen + (value[lastOpen] === '[' ? 2 : 1));
                      // The suffix is everything after the query
                      const suffix = value.substring(queryStart + query.length);
                      
                      // Add closing bracket based on opening
                      const closingBracket = value[lastOpen] === '{' ? '}' : ']]';
                      const newText = prefix + selected.text + closingBracket + suffix;
                      setInput(newText);
                      setIsAutocompleteOpen(false);
                      setAutocompleteQuery('');
                      setAutocompleteSuggestions([]);
                      setAutocompleteSelectionIndex(0);

                      // Move cursor after inserted text
                      setTimeout(() => {
                        if (textareaRef.current) {
                          textareaRef.current.focus();
                          textareaRef.current.setSelectionRange(
                            newText.length,
                            newText.length
                          );
                        }
                      }, 0);
                    }
                  }
                }
              } else if (e.key === 'Escape') {
                setIsAutocompleteOpen(false);
                setAutocompleteQuery('');
                setAutocompleteSuggestions([]);
                setAutocompleteSelectionIndex(0);
              }
            }}
            placeholder="Message Hermes..."
            ref={(el) => {
              textareaRef.current = el;
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            rows={1}
            value={input}
          />
          <div className="hermes-input-bottom">
            <div className="hermes-input-right">
              <button className="hermes-icon-btn" title="Add Image">
                <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                  <rect height="18" rx="2" ry="2" width="18" x="3" y="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </button>
              <button className="hermes-send-btn" disabled={isTyping || !input.trim()} onClick={handleSend} title="Send">
                <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                  <line x1="22" x2="11" y1="2" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Autocomplete pane - rendered outside the container for proper positioning */}
      {isAutocompleteOpen && autocompleteSuggestions.length > 0 && (
        <div
          className="hermes-autocomplete"
          style={{
            position: 'fixed' as const,
            left: autocompletePosition?.left,
            bottom: autocompletePosition?.bottom,
            width: autocompletePosition?.width || textareaRef.current?.offsetWidth
          }}
        >
          <div style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
            Type to search files...
          </div>
          {autocompleteSuggestions.map((suggestion, index) => (
            <div
              className={`hermes-autocomplete-item ${index === autocompleteSelectionIndex ? 'selected' : ''}`}
              key={suggestion.id}
              onClick={() => {
                const value = input;
                const lastOpen = Math.max(value.lastIndexOf('[['), value.lastIndexOf('{'));
                if (lastOpen >= 0) {
                  const prefix = value.substring(0, lastOpen + 2);
                  const suffix = value.substring(textareaRef.current?.selectionStart || 0);
                  const newText = prefix + suggestion.text + suffix;
                  setInput(newText);
                  setIsAutocompleteOpen(false);
                  setAutocompleteQuery('');
                  setAutocompleteSuggestions([]);
                  setAutocompleteSelectionIndex(0);

                  // Move cursor after inserted text
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                      textareaRef.current.setSelectionRange(
                        newText.length,
                        newText.length
                      );
                    }
                  }, 0);
                }
              }}
            >
              <span className="hermes-autocomplete-icon">
                {suggestion.type === 'folder' ? '📁' : '📄'}
              </span>
              <span className="hermes-autocomplete-text">{suggestion.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkdownRenderer({ content, view }: MarkdownRendererProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    // Clear previous content
    containerRef.current.innerHTML = '';

    // Use Obsidian's app.markdownRenderer API
    // Signature: renderMarkdown(markdown: string, container: HTMLElement, component: Component, filePath?: string, afterSection?: boolean)
    try {
      const app = view.app as any;
      if (app?.markdownRenderer && typeof app.markdownRenderer.renderMarkdown === 'function') {
        app.markdownRenderer.renderMarkdown(content, containerRef.current, view);
        return;
      }
    } catch (error) {
      console.debug('app.markdownRenderer.renderMarkdown failed:', error);
    }

    // Fallback: Use innerHTML with basic markdown parsing
    try {
      // Simple markdown to HTML conversion
      const html = content
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`(.*)`/gim, '<code>$1</code>')
        .replace(/\n/gim, '<br>');

      containerRef.current.innerHTML = html;
    } catch (error) {
      console.error('Failed to render markdown:', error);
      containerRef.current.textContent = content;
    }
  }, [content, view]);

  return <div className="hermes-markdown-renderer" ref={containerRef} />;
}
