import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plugin } from "../Plugin.ts";
import { CommunityPluginsManager } from "../CommunityPluginsManager.ts";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("obsidian", () => ({
  MarkdownView: class MarkdownView {},
  TFile: class TFile {},
}));

describe("CommunityPluginsManager - Git Push & Admonition", () => {
  let mockPlugin: Plugin;
  let manager: CommunityPluginsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlugin = {
      app: {
        vault: {
          adapter: {
            getBasePath: vi.fn().mockReturnValue("/mock/vault/path"),
          },
        },
        workspace: {
          getActiveViewOfType: vi.fn(),
        },
      },
    } as unknown as Plugin;
    manager = new CommunityPluginsManager(mockPlugin);
  });

  describe("runGitPush", () => {
    it("should return vault path error if getBasePath returns empty", async () => {
      (mockPlugin.app.vault.adapter as any).getBasePath = vi
        .fn()
        .mockReturnValue("");
      const result = await manager.runGitPush();
      expect(result).toBe("Unable to determine vault path for git execution.");
    });

    it("should execute git push and return formatted output on success", async () => {
      (execFile as any).mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "Everything up-to-date\n");
        },
      );
      const result = await manager.runGitPush();
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["push"],
        expect.objectContaining({ cwd: "/mock/vault/path" }),
        expect.any(Function),
      );
      expect(result).toBe(
        "### 🚀 Git Push\n\n```text\nEverything up-to-date\n```",
      );
    });

    it("should return default text if git push returns empty output", async () => {
      (execFile as any).mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(null, "");
        },
      );
      const result = await manager.runGitPush();
      expect(result).toBe(
        "### 🚀 Git Push\n\n```text\nSuccess (no output)\n```",
      );
    });

    it("should catch error and return failed message if execFile throws", async () => {
      (execFile as any).mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: Error | null, stdout: string) => void,
        ) => {
          cb(new Error("Could not resolve host"), "");
        },
      );
      const result = await manager.runGitPush();
      expect(result).toBe("Git push failed: Could not resolve host");
    });
  });

  describe("insertAdmonition", () => {
    it("should return error message if no active note editor found", () => {
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        null,
      );
      const result = manager.insertAdmonition("note");
      expect(result).toBe("No active note editor found. Open a note first.");
    });

    it("should insert admonition without title at cursor", () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: "MyNote" },
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );

      const result = manager.insertAdmonition("note");
      expect(mockReplaceSelection).toHaveBeenCalledWith("> [!note]\n> \n");
      expect(result).toBe(
        "Inserted **note** Admonition at cursor in **MyNote**.",
      );
    });

    it("should insert admonition with title at cursor", () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: "MyNote" },
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );

      const result = manager.insertAdmonition("warning", "Important Warning");
      expect(mockReplaceSelection).toHaveBeenCalledWith(
        "> [!warning] Important Warning\n> \n",
      );
      expect(result).toBe(
        "Inserted **warning** Admonition at cursor in **MyNote**.",
      );
    });
  });

  describe("generateTable", () => {
    it("should return error message if no active note editor found", () => {
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        null,
      );
      const result = manager.generateTable();
      expect(result).toBe("No active note editor found. Open a note first.");
    });

    it("should generate default 3x2 table when arguments are omitted", () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: "TableNote" },
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );

      const result = manager.generateTable();
      const expectedTable =
        "| Column | Column | Column |\n" +
        "| --- | --- | --- |\n" +
        "|   |   |   |\n" +
        "|   |   |   |\n";
      expect(mockReplaceSelection).toHaveBeenCalledWith(expectedTable);
      expect(result).toBe("Generated a 3x2 table at cursor in **TableNote**.");
    });

    it("should generate custom 4x3 table when custom dimensions provided", () => {
      const mockReplaceSelection = vi.fn();
      const mockActiveView = {
        editor: { replaceSelection: mockReplaceSelection },
        file: { basename: "TableNote" },
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );

      const result = manager.generateTable("4", "3");
      const expectedHeader = "| Column | Column | Column | Column |";
      const expectedSeparator = "| --- | --- | --- | --- |";
      const expectedRow = "|   |   |   |   |";
      const expectedTable = `${expectedHeader}\n${expectedSeparator}\n${expectedRow}\n${expectedRow}\n${expectedRow}\n`;

      expect(mockReplaceSelection).toHaveBeenCalledWith(expectedTable);
      expect(result).toBe("Generated a 4x3 table at cursor in **TableNote**.");
    });

    it("should return error if cols or rows are less than 1", () => {
      const mockActiveView = {
        editor: { replaceSelection: vi.fn() },
        file: { basename: "TableNote" },
      };
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );

      const result = manager.generateTable("0", "2");
      expect(result).toBe("Columns and rows must be at least 1.");
    });
  });

  describe("formatTable", () => {
    it("should return error message if no active note editor found", () => {
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        null,
      );
      const result = manager.formatTable();
      expect(result).toBe("No active note editor found. Open a note first.");
    });

    it("should trigger table format command and return success message", () => {
      const mockActiveView = {
        file: { basename: "TableNote" },
      };
      const mockExecuteCommand = vi.fn().mockReturnValue(true);
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );
      (mockPlugin.app as any).commands = {
        executeCommandById: mockExecuteCommand,
      };

      const result = manager.formatTable();
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "table-editor-obsidian:format-table",
      );
      expect(result).toBe(
        "Triggered Advanced Tables formatting in **TableNote**.",
      );
    });

    it("should return failure message if command execution fails or returns false", () => {
      const mockActiveView = {
        file: { basename: "TableNote" },
      };
      const mockExecuteCommand = vi.fn().mockReturnValue(false);
      (mockPlugin.app.workspace.getActiveViewOfType as any).mockReturnValue(
        mockActiveView,
      );
      (mockPlugin.app as any).commands = {
        executeCommandById: mockExecuteCommand,
      };

      const result = manager.formatTable();
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "table-editor-obsidian:format-table",
      );
      expect(result).toBe(
        "Failed to trigger Advanced Tables formatting. Make sure the plugin is enabled and your cursor is inside a table.",
      );
    });
  });
});
