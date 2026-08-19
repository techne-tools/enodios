import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "../Plugin.ts";
import { NoteComposerManager } from "../NoteComposerManager.ts";

// Define the fake class inside vi.hoisted() so it's available in vi.mock factories
const { FakeTFile } = vi.hoisted(() => {
  class FakeTFile {
    extension: string;
    path: string;
    basename: string;
    name: string;
    parent: { path: string };
    stat: { size: number; mtime: number; ctime: number };
    vault: any;

    constructor(path: string) {
      this.path = path;
      this.extension = path.split(".").pop() ?? "md";
      this.basename =
        path
          .split("/")
          .pop()
          ?.replace(/\.\w+$/, "") ?? "";
      this.name = path.split("/").pop() ?? "";
      this.parent = {
        path: path.includes("/") ? path.split("/").slice(0, -1).join("/") : "",
      };
      this.stat = { size: 0, mtime: 0, ctime: 0 };
      this.vault = null;
    }
  }
  return { FakeTFile };
});

vi.mock("obsidian", () => ({
  Notice: class Notice {
    constructor(public message: string) {}
  },
  TFile: FakeTFile,
}));

const makeMockPlugin = () =>
  ({
    app: {
      fileManager: {
        trashFile: vi.fn().mockResolvedValue(undefined),
      },
      vault: {
        create: vi.fn(),
        getAbstractFileByPath: vi.fn().mockReturnValue(null),
        modify: vi.fn().mockResolvedValue(undefined),
        read: vi.fn(),
      },
    },
    debug: { error: vi.fn() },
  }) as unknown as Plugin;

const makeFile = (path: string): import("obsidian").TFile =>
  new FakeTFile(path) as unknown as import("obsidian").TFile;

describe("NoteComposerManager", () => {
  describe("splitNoteAtHeading", () => {
    it("should return null when heading is not found", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue(
        "# Introduction\n\nSome content.",
      );
      const manager = new NoteComposerManager(plugin);
      const result = await manager.splitNoteAtHeading(
        makeFile("notes/my-note.md"),
        "Nonexistent",
      );
      expect(result).toBeNull();
    });

    it("should extract section under heading into a new file", async () => {
      const plugin = makeMockPlugin();
      const content =
        "# Intro\n\nIntro.\n\n## Background\n\nBackground text.\n\n## Conclusion\n\nConclusion.";
      (plugin.app.vault.read as any).mockResolvedValue(content);
      (plugin.app.vault.create as any).mockImplementation((p: string) =>
        Promise.resolve(makeFile(p)),
      );

      const manager = new NoteComposerManager(plugin);
      const file = makeFile("notes/my-note.md");
      const result = await manager.splitNoteAtHeading(file, "Background");

      expect(result).not.toBeNull();
      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining("background.md"),
        expect.stringContaining("## Background"),
      );
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        file,
        expect.stringContaining("![[Background]]"),
      );
    });

    it("should return null if destination note already exists", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue("## Target\n\nContent.");
      (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(
        makeFile("notes/target.md"),
      );

      const manager = new NoteComposerManager(plugin);
      const result = await manager.splitNoteAtHeading(
        makeFile("notes/source.md"),
        "Target",
      );
      expect(result).toBeNull();
    });
  });

  describe("mergeNotes", () => {
    it("should return null when no sources provided", async () => {
      const plugin = makeMockPlugin();
      const manager = new NoteComposerManager(plugin);
      expect(await manager.mergeNotes([], "merged.md")).toBeNull();
    });

    it("should return null if destination already exists", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(
        makeFile("merged.md"),
      );
      const manager = new NoteComposerManager(plugin);
      expect(
        await manager.mergeNotes([makeFile("a.md")], "merged.md"),
      ).toBeNull();
    });

    it("should merge multiple notes and trash sources by default", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
      (plugin.app.vault.read as any)
        .mockResolvedValueOnce("Content A")
        .mockResolvedValueOnce("Content B");
      (plugin.app.vault.create as any).mockResolvedValue(makeFile("merged.md"));

      const manager = new NoteComposerManager(plugin);
      const result = await manager.mergeNotes(
        [makeFile("a.md"), makeFile("b.md")],
        "merged.md",
      );

      expect(result).not.toBeNull();
      const [, createdContent] = (plugin.app.vault.create as any).mock
        .calls[0] as [string, string];
      expect(createdContent).toContain("Content A");
      expect(createdContent).toContain("Content B");
      expect(plugin.app.fileManager.trashFile).toHaveBeenCalledTimes(2);
    });

    it("should not trash sources when deleteSources is false", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
      (plugin.app.vault.read as any).mockResolvedValue("Content");
      (plugin.app.vault.create as any).mockResolvedValue(makeFile("merged.md"));

      const manager = new NoteComposerManager(plugin);
      await manager.mergeNotes([makeFile("a.md")], "merged.md", false);
      expect(plugin.app.fileManager.trashFile).not.toHaveBeenCalled();
    });
  });

  describe("extractSelection", () => {
    it("should return null for invalid range (fromChar >= toChar)", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue("Some content here.");
      const manager = new NoteComposerManager(plugin);
      expect(
        await manager.extractSelection(
          makeFile("test.md"),
          10,
          5,
          "extracted.md",
        ),
      ).toBeNull();
    });

    it("should extract selected range to new file", async () => {
      const plugin = makeMockPlugin();
      (plugin.app.vault.read as any).mockResolvedValue(
        "Hello World! This is extra.",
      );
      (plugin.app.vault.getAbstractFileByPath as any).mockReturnValue(null);
      (plugin.app.vault.create as any).mockResolvedValue(
        makeFile("extracted.md"),
      );

      const manager = new NoteComposerManager(plugin);
      const result = await manager.extractSelection(
        makeFile("source.md"),
        6,
        12,
        "extracted.md",
      );

      expect(result).not.toBeNull();
      const [createdPath, createdContent] = (plugin.app.vault.create as any)
        .mock.calls[0] as [string, string];
      expect(createdPath).toBe("extracted.md");
      expect(createdContent).toContain("World!");
      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("![[extracted]]"),
      );
    });
  });
});
