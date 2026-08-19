import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileChangeManager } from "../FileChangeManager.ts";
import type { Plugin } from "../Plugin.ts";
import { makeTFile } from "./mocks/obsidianFiles.ts";

// Mock obsidian
vi.mock("obsidian", () => ({
  MarkdownView: class MarkdownView {
    file = null;
    editor = { cm: null };
  },
  Notice: class Notice {
    constructor(public message: string) {}
  },
  TFile: class TFile {
    extension = "md";
    path = "";
    constructor(path?: string) {
      if (path) this.path = path;
    }
  },
  normalizePath: (path: string) => path.replace(/\\/g, "/"),
}));

function createMockPlugin(): Plugin {
  return {
    app: {
      vault: {
        getAbstractFileByPath: vi.fn(),
        read: vi.fn().mockResolvedValue(""),
        create: vi.fn().mockResolvedValue(undefined),
        modify: vi.fn().mockResolvedValue(undefined),
        trash: vi.fn().mockResolvedValue(undefined),
      },
      workspace: {
        getActiveViewOfType: vi.fn().mockReturnValue(null),
        getLeavesOfType: vi.fn().mockReturnValue([]),
        getLeaf: vi.fn().mockReturnValue({
          openFile: vi.fn().mockResolvedValue(undefined),
          view: { file: null },
        }),
      },
    },
    auditLog: {
      record: vi.fn(),
      recordFileChange: vi.fn(),
      recordToolCall: vi.fn(),
      recordPermission: vi.fn(),
      recordTerminal: vi.fn(),
      recordConnection: vi.fn(),
      getRecentEntries: vi.fn().mockResolvedValue([]),
      flush: vi.fn().mockResolvedValue(undefined),
    },
    vaultManager: {
      ensureFolderExists: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Plugin;
}

describe("FileChangeManager", () => {
  let plugin: Plugin;
  let manager: FileChangeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = createMockPlugin();
    manager = new FileChangeManager(plugin);
  });

  describe("registerChange", () => {
    it("should throw on path traversal attempts", async () => {
      await expect(
        manager.registerChange("../outside.md", "content"),
      ).rejects.toThrow("Invalid file path");
      await expect(
        manager.registerChange("/root.md", "content"),
      ).rejects.toThrow("Invalid file path");
    });

    it('should correctly assign "create" action for new files', async () => {
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      const change = await manager.registerChange("new.md", "content");

      expect(change.action).toBe("create");
      expect(change.status).toBe("pending");
    });

    it('should correctly assign "modify" action for existing files', async () => {
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(makeTFile("existing.md"));
      plugin.app.vault.read = vi.fn().mockResolvedValue("old content");

      const change = await manager.registerChange("existing.md", "new content");

      expect(change.action).toBe("modify");
      expect(change.originalContent).toBe("old content");
    });

    it('should correctly assign "delete" action when content is null', async () => {
      const change = await manager.registerChange("todelete.md", null);
      expect(change.action).toBe("delete");
    });
  });

  describe("approveChange", () => {
    it("should create new files and ensure parent folders exist", async () => {
      // When registerChange calls create, mock getAbstractFileByPath to return the file
      plugin.app.vault.create = vi
        .fn()
        .mockImplementation(async (path: string) => {
          const file = makeTFile(path);
          plugin.app.vault.getAbstractFileByPath = vi
            .fn()
            .mockReturnValue(file);
          return file;
        });

      const change = await manager.registerChange("folder/new.md", "content");
      await manager.approveChange(change.id);

      expect(plugin.vaultManager.ensureFolderExists).toHaveBeenCalledWith(
        "folder",
      );
      expect(plugin.app.vault.create).toHaveBeenCalledWith("folder/new.md", "");
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        expect.any(Object),
        "content",
      );
      expect(manager.getPendingChanges()).toHaveLength(0);
    });

    it("should modify existing files", async () => {
      const existingFile = makeTFile("existing.md");
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(existingFile);
      plugin.app.vault.read = vi.fn().mockResolvedValue("old content");

      const change = await manager.registerChange("existing.md", "new content");
      await manager.approveChange(change.id);

      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        existingFile,
        "new content",
      );
      expect(manager.getAllChanges()[0]?.status).toBe("approved");
    });

    it("should trash deleted files", async () => {
      const existingFile = makeTFile("todelete.md");
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValue(existingFile);

      const change = await manager.registerChange("todelete.md", null);
      await manager.approveChange(change.id);

      expect(plugin.app.vault.trash).toHaveBeenCalledWith(existingFile, true);
    });
  });

  describe("reject actions and clear", () => {
    it("should reject a single change without writing (cleans up empty file)", async () => {
      const file = makeTFile("test.md");
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
      plugin.app.vault.create = vi.fn().mockImplementation(async () => {
        plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
        return file;
      });
      plugin.app.vault.read = vi.fn().mockResolvedValue("");

      const change = await manager.registerChange("test.md", "content");
      await manager.rejectChange(change.id);

      expect(plugin.app.vault.create).toHaveBeenCalledWith("test.md", ""); // Created empty
      expect(plugin.app.vault.trash).toHaveBeenCalledWith(file, true); // Then trashed
      expect(manager.getPendingChanges()).toHaveLength(0);
      expect(manager.getAllChanges()[0]?.status).toBe("rejected");
    });

    it("should reject all changes", async () => {
      await manager.registerChange("test1.md", "content");
      await manager.registerChange("test2.md", "content");

      await manager.rejectAll();

      expect(manager.getPendingChanges()).toHaveLength(0);
      expect(
        manager.getAllChanges().every((c) => c.status === "rejected"),
      ).toBe(true);
    });

    it("should clear resolved changes from history", async () => {
      const change1 = await manager.registerChange("test1.md", "content");
      await manager.registerChange("test2.md", "content");

      await manager.rejectChange(change1.id); // Resolve one
      expect(manager.getAllChanges()).toHaveLength(2);

      manager.clearResolved();
      expect(manager.getAllChanges()).toHaveLength(1);
      expect(manager.getAllChanges()[0]?.status).toBe("pending");
    });
  });

  describe("concurrency locks", () => {
    it("should prevent concurrent approveChange calls for the same path", async () => {
      const file = makeTFile("test.md");
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);

      let modifyCalls = 0;
      plugin.app.vault.modify = vi.fn().mockImplementation(async () => {
        modifyCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const change = await manager.registerChange("test.md", "content");

      // Execute concurrently
      await Promise.all([
        manager.approveChange(change.id),
        manager.approveChange(change.id),
      ]);

      // The vault.modify should only be triggered once due to processingPaths lock
      expect(modifyCalls).toBe(1);
    });

    it("should prevent concurrent approveAll calls", async () => {
      plugin.app.vault.getAbstractFileByPath = vi
        .fn()
        .mockReturnValueOnce(makeTFile("test1.md"))
        .mockReturnValueOnce(makeTFile("test2.md"))
        .mockReturnValue(makeTFile("test.md")); // For subsequent calls

      let modifyCalls = 0;
      plugin.app.vault.modify = vi.fn().mockImplementation(async () => {
        modifyCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      await manager.registerChange("test1.md", "content 1");
      await manager.registerChange("test2.md", "content 2");

      // Execute concurrently
      await Promise.all([manager.approveAll(), manager.approveAll()]);

      // Should only process the queue once, resulting in exactly 2 modify calls
      // instead of potentially triggering 4 or causing overlapping errors.
      expect(modifyCalls).toBe(2);
    });
  });

  describe("processPartialChange", () => {
    it("should correctly approve an added line", async () => {
      const file = makeTFile("test.md");
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
      plugin.app.vault.read = vi.fn().mockResolvedValue("line 1\nline 2");

      const change = await manager.registerChange(
        "test.md",
        "line 1\nadded line\nline 2",
      );
      // The diffSnapshot should look like:
      // index 0: unchanged 'line 1'
      // index 1: added 'added line'
      // index 2: unchanged 'line 2'
      expect(change.diffSnapshot).toHaveLength(3);
      expect(change.diffSnapshot?.[1]?.type).toBe("added");

      await manager.processPartialChange(change.id, [1], "approve");

      // The new disk file should contain the approved added line
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        file,
        "line 1\nadded line\nline 2",
      );
      // After approval, the newContent should still have it (it matches the disk)
      expect(change.newContent).toBe("line 1\nadded line\nline 2");
    });

    it("should correctly reject an added line", async () => {
      const file = makeTFile("test.md");
      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(file);
      plugin.app.vault.read = vi.fn().mockResolvedValue("line 1\nline 2");

      const change = await manager.registerChange(
        "test.md",
        "line 1\nadded line\nline 2",
      );
      expect(change.diffSnapshot?.[1]?.type).toBe("added");

      await manager.processPartialChange(change.id, [1], "reject");

      // The disk file should NOT have the added line (stays original)
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        file,
        "line 1\nline 2",
      );
      // The newContent should have the added line removed
      expect(change.newContent).toBe("line 1\nline 2");
    });
  });

  describe("handleActiveLeafChange", () => {
    it("should trigger inline diff if active view has a pending change", async () => {
      const file = makeTFile("active.md");

      const mockCm = {
        dispatch: vi.fn(),
      };

      const { MarkdownView } = await import("obsidian");
      // The mock MarkdownView has a zero-arg constructor while the real type
      // requires a leaf. Cast through unknown to satisfy both.
      const MockMarkdownView = MarkdownView as unknown as {
        new (): { file: unknown; editor: unknown };
      };
      const mockMarkdownView = new MockMarkdownView();
      mockMarkdownView.file = file as any;
      mockMarkdownView.editor = { cm: mockCm as any } as any;

      plugin.app.workspace.getActiveViewOfType = vi
        .fn()
        .mockReturnValue(mockMarkdownView);

      await manager.registerChange("active.md", "content");

      vi.useFakeTimers();
      manager.handleActiveLeafChange();
      vi.advanceTimersByTime(100);
      vi.useRealTimers();

      expect(mockCm.dispatch).toHaveBeenCalled();
    });
  });
});
