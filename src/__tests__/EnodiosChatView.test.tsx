// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { Notice } from 'obsidian';
import { EnodiosChatViewComponent } from '../Views/EnodiosChatView.tsx';
import type { EnodiosChatView } from '../Views/EnodiosChatView.tsx';
import type { ChatSessionUpdate } from '../ChatClient.ts';
import type { Plugin } from '../Plugin.ts';

// 1. Mock Obsidian APIs
vi.mock('obsidian', () => {
  class Component {
    load() {}
    unload() {}
  }
  class View extends Component {}
  class ItemView extends View {
    constructor(leaf: any) {
      super();
    }
  }
  class MarkdownView extends View {
    file = null;
  }
  return {
    Component,
    View,
    ItemView,
    MarkdownView,
    Notice: vi.fn(),
    MarkdownRenderer: {
      // Mock the renderer to simply inject the text content so we can assert on it
      render: vi.fn().mockImplementation(async (app, content, el) => {
        el.textContent = content;
      })
    },
    normalizePath: (p: string) => p,
    arrayBufferToBase64: () => 'base64',
  };
});

// 2. Mock Browser APIs
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('EnodiosChatView - Chat UI Logic', () => {
  let mockView: EnodiosChatView;
  let mockPlugin: Plugin;
  let updateCallback: (update: ChatSessionUpdate) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    let currentTime = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      currentTime += 3000;
      return currentTime;
    });

    mockPlugin = {
      fileChangeManager: { onChanges: vi.fn().mockReturnValue(vi.fn()) },
      acpClient: { onPermissionsChange: vi.fn().mockReturnValue(vi.fn()) },
      app: {
        workspace: {
          on: vi.fn().mockReturnValue('event-ref'),
          offref: vi.fn(),
          getActiveFile: vi.fn().mockReturnValue(null),
          getLeavesOfType: vi.fn().mockReturnValue([]),
          getMostRecentLeaf: vi.fn().mockReturnValue(null),
        },
        vault: {
          getRoot: vi.fn().mockReturnValue({ path: '/' }),
          getMarkdownFiles: vi.fn().mockReturnValue([
            { path: 'test-note.md', basename: 'test-note', stat: { mtime: 100 } }
          ]),
          cachedRead: vi.fn().mockResolvedValue('This is a test note containing a secret project goal.'),
        },
      },
      vaultManager: {
        listConversations: vi.fn().mockResolvedValue([]),
        saveConversation: vi.fn().mockResolvedValue('hermes/chat-1.md'),
      },
      templateManager: {
        loadTemplates: vi.fn().mockResolvedValue([])
      },
      debug: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    } as unknown as Plugin;

    mockView = {
      plugin: mockPlugin,
      getPlugin: () => mockPlugin,
      getSettings: () => ({
        chatAgentName: 'Hermes',
        showReasoning: false,
        showToolUse: false,
      }),
      subscribeToUpdates: vi.fn((cb) => {
        updateCallback = cb;
        return vi.fn();
      }),
      subscribeToErrors: vi.fn().mockReturnValue(vi.fn()),
      subscribeToAvailableCommands: vi.fn().mockReturnValue(vi.fn()),
      subscribeToConnectionStatus: vi.fn().mockReturnValue(vi.fn()),
      sendPrompt: vi.fn().mockResolvedValue(undefined),
      clearConversation: vi.fn(),
    } as unknown as EnodiosChatView;
  });

  it('should append on handleSend and truncate/branch on handleEditSubmit', async () => {
    render(<EnodiosChatViewComponent view={mockView} />);
    const input = screen.getByPlaceholderText('Message Hermes...');

    // --- 1. Simulate handleSend (Append first message) ---
    fireEvent.change(input, { target: { value: 'First prompt' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(mockView.sendPrompt).toHaveBeenCalledWith('First prompt', [], { allowedTools: null });

    // Simulate agent finishing the generation
    await waitFor(() => expect(updateCallback).toBeDefined());
    act(() => {
      updateCallback({ type: 'stop' });
    });

    // Wait for the message to be rendered
    await screen.findByText('First prompt');

    // --- 2. Simulate handleSend (Append second message) ---
    fireEvent.change(input, { target: { value: 'Second prompt' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(updateCallback).toBeDefined());
    act(() => {
      updateCallback({ type: 'stop' }); // Agent finishes
    });

    await screen.findByText('Second prompt');

    // --- 3. Simulate handleEditSubmit (Branching the history) ---
    const editButtons = await screen.findAllByTitle('Edit Message');
    expect(editButtons.length).toBe(2); // One for each prompt

    // Click "Edit" on the FIRST message
    fireEvent.click(editButtons[0]);
    const editInput = screen.getByDisplayValue('First prompt');
    fireEvent.change(editInput, { target: { value: 'Edited first prompt' } });
    fireEvent.click(screen.getByText('Save & Submit'));

    // Assert: The second message was dropped from the DOM, and sendPrompt was called again
    await waitFor(() => {
      expect(screen.queryByText('Second prompt')).toBeNull();
    });
    expect(mockView.sendPrompt).toHaveBeenCalledWith('Edited first prompt', [], { allowedTools: null });
  });

  it('should reject files larger than 5MB when attaching', async () => {
    render(<EnodiosChatViewComponent view={mockView} />);

    const largeFile = new File([''], 'huge-document.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 }); // 6MB

    // eslint-disable-next-line testing-library/no-node-access -- No test ID on the hidden file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [largeFile] } });
    });

    expect(Notice).toHaveBeenCalledWith('File "huge-document.pdf" exceeds the 5MB limit and was skipped. Please process large files in another app.');
    expect(screen.queryByText('📄 huge-document.pdf')).toBeNull();
  });

  it('should disable the Send button while the agent is typing', async () => {
    render(<EnodiosChatViewComponent view={mockView} />);
    const input = screen.getByPlaceholderText('Message Hermes...');
    const sendButton = screen.getByTitle('Send') as HTMLButtonElement;

    // Initially disabled because the input is empty
    expect(sendButton.disabled).toBe(true);

    // Type a prompt, button should be enabled
    fireEvent.change(input, { target: { value: 'First prompt' } });
    expect(sendButton.disabled).toBe(false);

    // Click send
    fireEvent.click(sendButton);

    // User types their next prompt while the agent is generating
    fireEvent.change(input, { target: { value: 'Second prompt' } });
    expect(sendButton.disabled).toBe(true); // Still disabled because isTyping is true!

    // Simulate agent finishing the generation
    await waitFor(() => expect(updateCallback).toBeDefined());
    act(() => {
      updateCallback({ type: 'stop' });
    });

    // Now the button should be re-enabled for the next prompt
    await waitFor(() => {
      expect(sendButton.disabled).toBe(false);
    });
  });

  it('should open autocomplete and insert text when typing [[', async () => {
    render(<EnodiosChatViewComponent view={mockView} />);
    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;

    // Type [[ to open, then type "test" to filter
    fireEvent.change(input, { target: { value: '[[' } });
    fireEvent.change(input, { target: { value: '[[test' } });

    // JSDOM doesn't automatically move the cursor to the end of the value during fireEvent.change
    input.selectionStart = 6;
    input.selectionEnd = 6;

    // The autocomplete should appear with the matched file
    await waitFor(() => {
      expect(screen.getByText('Type to search files...')).toBeDefined();
      expect(screen.getByText('test-note.md')).toBeDefined();
    });

    // Press Enter to select the first suggestion
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    // The autocomplete should close and the file should be added to the context items
    await waitFor(() => {
      expect(screen.queryByText('Type to search files...')).toBeNull();
      expect(input.value).toBe('');
      expect(screen.getByText('test-note.md')).toBeDefined();
    });
  });

  it('should execute the /search slash command and display results', async () => {
    render(<EnodiosChatViewComponent view={mockView} />);
    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;

    // Type the slash command
    fireEvent.change(input, { target: { value: '/search secret' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    // The command should execute and add a system message with the results
    await waitFor(() => {
      expect(screen.getByText(/Vault Search Results for "secret"/)).toBeDefined();
    });
    expect(input.value).toBe('');
  });
});
