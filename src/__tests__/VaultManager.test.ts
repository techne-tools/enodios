import { describe, expect, it, vi, beforeEach } from "vitest";
import { VaultManager } from "../VaultManager.ts";
import type { Plugin } from "../Plugin.ts";
import type { ChatMessage } from "../Views/EnodiosChatView.tsx";
import { makeTFile, makeTFolder } from "./mocks/obsidianFiles.ts";

// Mock Obsidian modules
vi.mock("obsidian", () => ({
  normalizePath: (path: string) =>
    path.replace(/\\/g, "/").replace(/\/+/g, "/"),
  Notice: class Notice {
    constructor(public message: string) {}
  },
  TFile: class TFile {
    extension = "md";
    path = "";
    stat = { ctime: Date.now(), mtime: Date.now() };
    constructor(path: string) {
      this.path = path;
    }
  },
  TFolder: class TFolder {
    children: any[] = [];
    path = "";
    constructor(path: string) {
      this.path = path;
    }
  },
}));

function createMockPlugin(overrides?: Partial<Plugin>): Plugin {
  const mockVault = {
    create: vi.fn(),
    createFolder: vi.fn(),
    getAbstractFileByPath: vi.fn(),
    modify: vi.fn(),
    read: vi.fn(),
    trash: vi.fn(),
  };

  return {
    app: {
      vault: mockVault,
      workspace: {
        getActiveFile: vi.fn(),
      },
      metadataCache: {
        getFileCache: vi.fn().mockReturnValue(null),
      },
      fileManager: {
        renameFile: vi.fn(),
      },
    },
    settings: {
      chatSaveFolder: "hermes",
    },
    ...overrides,
  } as unknown as Plugin;
}

describe("VaultManager", () => {
  let plugin: Plugin;
  let vaultManager: VaultManager;

  beforeEach(() => {
    plugin = createMockPlugin();
    vaultManager = new VaultManager(plugin);
  });

  describe("ensureSaveFolder", () => {
    it("should return existing folder if it exists", async () => {
      const existingFolder = makeTFolder("hermes");
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(existingFolder);

      const result = await vaultManager.ensureSaveFolder();

      expect(result).toBe(existingFolder);
      expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
    });

    it("should create folder if it does not exist", async () => {
      const newFolder = makeTFolder("hermes");
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      plugin.app.vault.createFolder = vi.fn().mockResolvedValue(newFolder);

      const result = await vaultManager.ensureSaveFolder();

      expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("hermes");
      expect(result).toBe(newFolder);
    });
  });

  describe("saveConversation", () => {
    it("should return null for empty messages", async () => {
      const result = await vaultManager.saveConversation([]);
      expect(result).toBeNull();
    });

    it("should create a conversation file with frontmatter", async () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          content: "Hello",
          role: "user",
          timestamp: 1700000000000,
        },
        {
          id: "msg-2",
          content: "Hi there!",
          role: "assistant",
          timestamp: 1700000001000,
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/test-2023-11-14-1700000000000.md" });

      const result = await vaultManager.saveConversation(messages, "Test Chat");

      expect(result).not.toBeNull();
      expect(plugin.app.vault.create).toHaveBeenCalled();

      const callArgs = vi.mocked(plugin.app.vault.create).mock.calls[0];
      const filePath = callArgs?.[0] as string;
      const content = callArgs?.[1] as string;

      expect(filePath).toMatch(/^hermes\/test-/);
      expect(content).toContain("---");
      expect(content).toContain("type: enodios-conversation");
      expect(content).toContain("**You**");
      expect(content).toContain("**Hermes**");
    });

    it("should use default title when none provided", async () => {
      const messages: ChatMessage[] = [
        { id: "msg-1", content: "Hello", role: "user", timestamp: Date.now() },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/conversation.md" });

      await vaultManager.saveConversation(messages);

      const callArgs = vi.mocked(plugin.app.vault.create).mock.calls[0];
      const content = callArgs?.[1] as string;

      expect(content).toContain("title: Conversation");
    });

    it("should handle vault errors gracefully", async () => {
      const messages: ChatMessage[] = [
        { id: "msg-1", content: "Hello", role: "user", timestamp: Date.now() },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockRejectedValue(new Error("Disk full"));

      const result = await vaultManager.saveConversation(messages);

      expect(result).toBeNull();
    });
  });

  describe("loadConversation", () => {
    it("should parse markdown content into messages", async () => {
      const mockContent = `---
id: conv-123
title: Test Chat
createdAt: 1700000000000
updatedAt: 1700000001000
type: enodios-conversation
---

## **You** — 11/14/2023, 12:00:00 PM

Hello there

---

## **Hermes** — 11/14/2023, 12:00:01 PM

Hello! How can I help?
`;

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFile("hermes/test.md"));
      plugin.app.vault.read = vi.fn().mockResolvedValue(mockContent);

      const result = await vaultManager.loadConversation("hermes/test.md");

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Test Chat");
      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[0]?.role).toBe("user");
      expect(result?.messages[0]?.content).toBe("Hello there");
      expect(result?.messages[1]?.role).toBe("assistant");
      expect(result?.messages[1]?.content).toBe("Hello! How can I help?");
    });

    it("should parse messages containing horizontal rules correctly without discarding content", async () => {
      const mockContent = `---
id: conv-123
title: Test Chat
createdAt: 1700000000000
updatedAt: 1700000001000
type: enodios-conversation
---

## **You** — 11/14/2023, 12:00:00 PM

Hello there

---

How are you?
`;

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFile("hermes/test.md"));
      plugin.app.vault.read = vi.fn().mockResolvedValue(mockContent);

      const result = await vaultManager.loadConversation("hermes/test.md");

      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(1);
      expect(result?.messages[0]?.role).toBe("user");
      expect(result?.messages[0]?.content).toBe(
        "Hello there\n\n---\n\nHow are you?",
      );
    });

    it("should return null for non-existent file", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.loadConversation("hermes/missing.md");

      expect(result).toBeNull();
    });

    it("should handle read errors gracefully", async () => {
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFile("hermes/test.md"));
      plugin.app.vault.read = vi
        .fn()
        .mockRejectedValue(new Error("Read error"));

      const result = await vaultManager.loadConversation("hermes/test.md");

      expect(result).toBeNull();
    });
  });

  describe("updateConversation", () => {
    it("should update existing file content", async () => {
      const mockFile = makeTFile("hermes/test.md");
      const messages: ChatMessage[] = [
        {
          id: "msg-updated",
          content: "Updated",
          role: "user",
          timestamp: Date.now(),
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(mockFile);
      plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

      const result = await vaultManager.updateConversation(
        "hermes/test.md",
        messages,
        "Updated Chat",
      );

      expect(result).toBe(true);
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        mockFile,
        expect.stringContaining("Updated Chat"),
      );
    });

    it("should return false for non-existent file", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.updateConversation(
        "hermes/missing.md",
        [],
        "Title",
      );

      expect(result).toBe(false);
    });

    it("should rename file when orgMode is by-project and newPath differs from current path", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";

      const initialFile = makeTFile(
        "hermes/general/my-chat-2023-11-14-1700000000000.md",
      );
      initialFile.stat = {
        ctime: 1700000000000,
        mtime: 1700000000000,
        size: 0,
      };

      const movedFile = makeTFile(
        "hermes/project-beta/my-chat-2023-11-14-1700000000000.md",
      );

      const messages: ChatMessage[] = [
        {
          id: "msg-project-beta",
          content: "Working on #project-beta feature",
          role: "user",
          timestamp: Date.now(),
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi.fn((path: string) => {
        if (path === "hermes/general/my-chat-2023-11-14-1700000000000.md")
          return initialFile;
        if (path === "hermes/project-beta/my-chat-2023-11-14-1700000000000.md")
          return movedFile;
        if (path === "hermes/project-beta")
          return makeTFolder("hermes/project-beta");
        return null;
      });
      plugin.app.vault.createFolder = vi
        .fn()
        .mockResolvedValue(makeTFolder("hermes/project-beta"));
      plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);
      plugin.app.fileManager.renameFile = vi.fn().mockResolvedValue(undefined);

      const result = await vaultManager.updateConversation(
        "hermes/general/my-chat-2023-11-14-1700000000000.md",
        messages,
        "My Chat",
      );

      expect(result).toBe(true);
      expect(plugin.app.fileManager.renameFile).toHaveBeenCalledWith(
        initialFile,
        "hermes/project-beta/my-chat-2023-11-14-1700000000000.md",
      );
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        movedFile,
        expect.stringContaining("My Chat"),
      );
    });

    it("should not rename file when newPath matches current path", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";

      const initialFile = makeTFile(
        "hermes/general/my-chat-2023-11-14-1700000000000.md",
      );
      initialFile.stat = {
        ctime: 1700000000000,
        mtime: 1700000000000,
        size: 0,
      };

      const messages: ChatMessage[] = [
        {
          id: "msg-no-project",
          content: "No project tag here",
          role: "user",
          timestamp: Date.now(),
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(initialFile);
      plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

      const result = await vaultManager.updateConversation(
        "hermes/general/my-chat-2023-11-14-1700000000000.md",
        messages,
        "My Chat",
      );

      expect(result).toBe(true);
      expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        initialFile,
        expect.stringContaining("My Chat"),
      );
    });
  });

  describe("deleteConversation", () => {
    it("should trash existing file", async () => {
      const mockFile = makeTFile("hermes/test.md");

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(mockFile);
      plugin.app.vault.trash = vi.fn().mockResolvedValue(undefined);

      const result = await vaultManager.deleteConversation("hermes/test.md");

      expect(result).toBe(true);
      expect(plugin.app.vault.trash).toHaveBeenCalledWith(mockFile, true);
    });

    it("should return false for non-existent file", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.deleteConversation("hermes/missing.md");

      expect(result).toBe(false);
    });
  });

  describe("listConversations", () => {
    it("should return empty array when folder does not exist", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.listConversations();

      expect(result).toEqual([]);
    });

    it("should list and sort conversations by updatedAt", async () => {
      const folder = makeTFolder("hermes");
      const file1 = makeTFile("hermes/chat1.md");
      const file2 = makeTFile("hermes/chat2.md");

      // Mock stat values for sorting fallback
      Object.assign(file1, { stat: { ctime: 1000, mtime: 3000 } });
      Object.assign(file2, { stat: { ctime: 1000, mtime: 5000 } });

      folder.children = [file1, file2];

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(folder);
      plugin.app.vault.read = vi
        .fn()
        .mockResolvedValueOnce(
          `---\nid: conv-1\ntitle: Chat One\ncreatedAt: 1000\nupdatedAt: 3000\n---\n`,
        )
        .mockResolvedValueOnce(
          `---\nid: conv-2\ntitle: Chat Two\ncreatedAt: 1000\nupdatedAt: 5000\n---\n`,
        );

      const result = await vaultManager.listConversations();

      expect(result).toHaveLength(2);
      expect(result[0]?.metadata.title).toBe("Chat Two"); // Most recent first
      expect(result[1]?.metadata.title).toBe("Chat One");
    });

    it("should skip non-markdown files", async () => {
      const folder = makeTFolder("hermes");
      const mdFile = makeTFile("hermes/chat.md");
      const txtFile = makeTFile("hermes/notes.txt");

      Object.assign(txtFile, { extension: "txt" });
      folder.children = [mdFile, txtFile];

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(folder);
      plugin.app.vault.read = vi
        .fn()
        .mockResolvedValue(
          `---\nid: conv-1\ntitle: Chat\ncreatedAt: 1000\nupdatedAt: 1000\n---\n`,
        );

      const result = await vaultManager.listConversations();

      expect(result).toHaveLength(1);
      expect(result[0]?.metadata.title).toBe("Chat");
    });
  });

  describe("createNote", () => {
    it("should create a note with parent folders", async () => {
      const mockFile = makeTFile("folder/note.md");

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      plugin.app.vault.createFolder = vi
        .fn()
        .mockResolvedValue(makeTFolder("folder") as any);
      plugin.app.vault.create = vi.fn().mockResolvedValue(mockFile);

      const result = await vaultManager.createNote("folder/note.md", "# Hello");

      expect(result).toBe(mockFile);
      expect(plugin.app.vault.createFolder).toHaveBeenCalledWith("folder");
      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        "folder/note.md",
        "# Hello",
      );
    });

    it("should handle creation errors", async () => {
      plugin.app.vault.create = vi.fn().mockRejectedValue(new Error("Exists"));

      const result = await vaultManager.createNote("note.md", "content");

      expect(result).toBeNull();
    });
  });

  describe("readNote", () => {
    it("should read note content", async () => {
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFile("note.md"));
      plugin.app.vault.read = vi.fn().mockResolvedValue("Note content");

      const result = await vaultManager.readNote("note.md");

      expect(result).toBe("Note content");
    });

    it("should return null for non-existent note", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.readNote("missing.md");

      expect(result).toBeNull();
    });
  });

  describe("updateNote", () => {
    it("should update existing note", async () => {
      const mockFile = makeTFile("note.md");

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(mockFile);
      plugin.app.vault.modify = vi.fn().mockResolvedValue(undefined);

      const result = await vaultManager.updateNote("note.md", "New content");

      expect(result).toBe(true);
    });

    it("should return false for non-existent note", async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);

      const result = await vaultManager.updateNote("missing.md", "content");

      expect(result).toBe(false);
    });
  });

  describe("conversation organization and tag resolution", () => {
    it("should save conversation under by-date folder structure when configured", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-date";
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          content: "Hello",
          role: "user",
          timestamp: 1700000000000,
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({
          path: "hermes/2023-11/test-2023-11-14-1700000000000.md",
        });

      const result = await vaultManager.saveConversation(messages, "Test Chat");

      expect(result).not.toBeNull();
      const callArgs = vi.mocked(plugin.app.vault.create).mock.calls[0];
      const filePath = callArgs?.[0] as string;
      expect(filePath).toMatch(/^hermes\/\d{4}-\d{2}\/test-chat-/);
    });

    it("should resolve project folder from active file frontmatter tags", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";
      const mockActiveFile = makeTFile("notes/active.md");
      (plugin.app.workspace.getActiveFile as any).mockReturnValue(
        mockActiveFile,
      );
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
        frontmatter: { tags: ["#Project-Alpha/Feature"] },
      });

      const messages: ChatMessage[] = [
        { id: "msg-1", content: "Hello", role: "user", timestamp: Date.now() },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/project-alpha/feature/test.md" });

      await vaultManager.saveConversation(messages, "Test");

      const filePath = vi.mocked(plugin.app.vault.create).mock
        .calls[0]?.[0] as string;
      expect(filePath).toMatch(/^hermes\/project-alpha\/feature\/test-/);
    });

    it("should resolve project folder from active file cache tags if frontmatter is missing", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";
      const mockActiveFile = makeTFile("notes/active.md");
      (plugin.app.workspace.getActiveFile as any).mockReturnValue(
        mockActiveFile,
      );
      (plugin.app.metadataCache.getFileCache as any).mockReturnValue({
        tags: [{ tag: "#Deep_Learning" }],
      });

      const messages: ChatMessage[] = [
        { id: "msg-1", content: "Hello", role: "user", timestamp: Date.now() },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/deep_learning/test.md" });

      await vaultManager.saveConversation(messages, "Test");

      const filePath = vi.mocked(plugin.app.vault.create).mock
        .calls[0]?.[0] as string;
      expect(filePath).toMatch(/^hermes\/deep_learning\/test-/);
    });

    it("should resolve project folder from message content tags when no active file tag exists", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";
      (plugin.app.workspace.getActiveFile as any).mockReturnValue(null);

      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          content: "Let us work on #backend-refactor today!",
          role: "user",
          timestamp: Date.now(),
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/backend-refactor/test.md" });

      await vaultManager.saveConversation(messages, "Test");

      const filePath = vi.mocked(plugin.app.vault.create).mock
        .calls[0]?.[0] as string;
      expect(filePath).toMatch(/^hermes\/backend-refactor\/test-/);
    });

    it("should fallback to general folder when no tag is found anywhere", async () => {
      (
        plugin.settings as { conversationOrganization: string }
      ).conversationOrganization = "by-project";
      (plugin.app.workspace.getActiveFile as any).mockReturnValue(null);

      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          content: "No tags in this conversation",
          role: "user",
          timestamp: Date.now(),
        },
      ];

      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFolder("hermes"));
      plugin.app.vault.create = vi
        .fn()
        .mockResolvedValue({ path: "hermes/general/test.md" });

      await vaultManager.saveConversation(messages, "Test");

      const filePath = vi.mocked(plugin.app.vault.create).mock
        .calls[0]?.[0] as string;
      expect(filePath).toMatch(/^hermes\/general\/test-/);
    });
  });
});
