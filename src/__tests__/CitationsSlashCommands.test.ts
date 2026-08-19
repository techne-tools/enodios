import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Plugin } from "../Plugin.ts";

if (typeof window === "undefined") {
  (global as any).window = global;
  (global as any).window.dispatchEvent = () => true;
}

import { getSlashCommands } from "../SlashCommands.ts";
import { makeTFile } from "./mocks/obsidianFiles.ts";

// Mock obsidian module
vi.mock("obsidian", () => ({
  TFile: class TFile {
    extension = "md";
    path = "";
    basename = "";
    constructor(path = "", ext = "md") {
      this.path = path;
      this.extension = ext;
      this.basename = path.split("/").pop()?.replace(`.${ext}`, "") || "";
    }
  },
  Notice: class Notice {
    constructor(public message: string) {}
  },
}));

describe("SlashCommands execution", () => {
  let mockPlugin: any;

  beforeEach(() => {
    mockPlugin = {
      app: {
        workspace: {
          getActiveFile: vi.fn(),
          getLeavesOfType: vi.fn(),
        },
        vault: {
          getAbstractFileByPath: vi.fn(),
          read: vi.fn(),
          modify: vi.fn(),
          getFiles: vi.fn(),
        },
      },
      settings: {
        citationStyle: "apa",
        bibliographyPath: "references.bib",
        enableCitations: true,
        enableAnnotations: true,
        enableTags: true,
      },
      settingsManager: {
        saveToFile: vi.fn().mockResolvedValue(undefined),
      },
      citationManager: {
        loadBibliography: vi.fn().mockResolvedValue([]),
        search: vi.fn().mockReturnValue([]),
        generateBibliographyForContent: vi.fn().mockReturnValue(""),
      },
      pdfAnnotationManager: {
        extractAnnotations: vi.fn().mockResolvedValue([]),
        formatAnnotationsMarkdown: vi.fn().mockReturnValue(""),
        extractPageText: vi.fn().mockResolvedValue("Mock page text"),
        extractMetadata: vi.fn().mockResolvedValue({ Title: "Mock PDF" }),
      },
      tagManager: {
        suggestTagsForContent: vi
          .fn()
          .mockReturnValue([{ tag: "#academic", confidence: 0.85 }]),
        applyTagsToNote: vi.fn().mockResolvedValue(undefined),
      },
      templateManager: {
        loadTemplates: vi
          .fn()
          .mockResolvedValue([
            {
              id: "coach",
              name: "Coach",
              prompt: "Be a coach",
              icon: "✍️",
              description: "Coaching",
            },
          ]),
        saveTemplate: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it("should have cite, annotations, context, tags, template, and pdf commands registered", () => {
    const commands = getSlashCommands();
    const names = commands.map((c) => c.name);

    expect(names).toContain("cite");
    expect(names).toContain("annotations");
    expect(names).toContain("context");
    expect(names).toContain("tags");
    expect(names).toContain("template");
    expect(names).toContain("pdf");
  });

  describe("/cite style command", () => {
    it("should change active style in settings", async () => {
      const citeCmd = getSlashCommands().find((c) => c.name === "cite");
      expect(citeCmd).toBeDefined();

      const result = await citeCmd!.execute(mockPlugin as Plugin, "style ieee");
      expect(result).toBe("Citation style updated to **IEEE**.");
      expect(mockPlugin.settings.citationStyle).toBe("ieee");
      expect(mockPlugin.settingsManager.saveToFile).toHaveBeenCalled();
    });

    it("should return error for invalid style", async () => {
      const citeCmd = getSlashCommands().find((c) => c.name === "cite");
      const result = await citeCmd!.execute(
        mockPlugin as Plugin,
        "style invalid",
      );
      expect(result).toContain("Invalid style");
    });
  });

  describe("/annotations command", () => {
    it("should extract annotations for valid PDF path", async () => {
      const annotCmd = getSlashCommands().find((c) => c.name === "annotations");
      expect(annotCmd).toBeDefined();

      const mockFile = makeTFile("papers/doc.pdf", "pdf");
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);
      mockPlugin.pdfAnnotationManager.extractAnnotations.mockResolvedValue([
        { id: "1", page: 1, type: "highlight", text: "Important" },
      ]);
      mockPlugin.pdfAnnotationManager.formatAnnotationsMarkdown.mockReturnValue(
        "Formatted Annotations",
      );

      const result = await annotCmd!.execute(
        mockPlugin as Plugin,
        "papers/doc.pdf",
      );
      expect(result).toBe("Formatted Annotations");
      expect(
        mockPlugin.pdfAnnotationManager.extractAnnotations,
      ).toHaveBeenCalledWith(mockFile);
    });

    it("should return error for non-existent file", async () => {
      const annotCmd = getSlashCommands().find((c) => c.name === "annotations");
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

      const result = await annotCmd!.execute(
        mockPlugin as Plugin,
        "missing.pdf",
      );
      expect(result).toContain("File not found");
    });
  });

  describe("/context command", () => {
    it("should summarize active context items", async () => {
      const contextCmd = getSlashCommands().find((c) => c.name === "context");
      expect(contextCmd).toBeDefined();

      const mockView = {
        activeContextItems: [
          { id: "note-notes/test.md", text: "test", type: "note" },
          { id: "selection-123", text: "Selected Text", type: "selection" },
        ],
      };
      mockPlugin.app.workspace.getLeavesOfType.mockReturnValue([
        { view: mockView },
      ]);
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue({
        path: "notes/test.md",
      });
      mockPlugin.app.vault.read.mockResolvedValue(
        "Hello World! This note has words.",
      );

      const result = await contextCmd!.execute(mockPlugin as Plugin, "");
      expect(result).toContain("### 📎 Active Chat Context");
      expect(result).toContain("**[NOTE]** test");
      expect(result).toContain("**[SELECTION]** Selected Text");
    });
  });

  describe("/tags command", () => {
    it("should suggest tags", async () => {
      const tagsCmd = getSlashCommands().find((c) => c.name === "tags");
      expect(tagsCmd).toBeDefined();

      const mockFile = makeTFile("notes/test.md", "md");
      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue("Some text");

      const result = await tagsCmd!.execute(mockPlugin as Plugin, "suggest");
      expect(result).toContain("### 🏷️ Tag Suggestions for **test**");
      expect(result).toContain("**#academic** (85% confidence)");
    });

    it("should apply tags", async () => {
      const tagsCmd = getSlashCommands().find((c) => c.name === "tags");
      const mockFile = makeTFile("notes/test.md", "md");
      mockPlugin.app.workspace.getActiveFile.mockReturnValue(mockFile);

      const result = await tagsCmd!.execute(
        mockPlugin as Plugin,
        "apply academic study",
      );
      expect(result).toContain("Applied tags: **academic**, **study**");
      expect(mockPlugin.tagManager.applyTagsToNote).toHaveBeenCalledWith(
        mockFile,
        ["academic", "study"],
      );
    });
  });

  describe("/template command", () => {
    it("should list templates", async () => {
      const tplCmd = getSlashCommands().find((c) => c.name === "template");
      expect(tplCmd).toBeDefined();

      const result = await tplCmd!.execute(mockPlugin as Plugin, "list");
      expect(result).toContain("### 📚 Conversation Templates");
      expect(result).toContain("**✍️ Coach** — Coaching");
    });

    it("should load template and dispatch event", async () => {
      const tplCmd = getSlashCommands().find((c) => c.name === "template");
      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      const result = await tplCmd!.execute(mockPlugin as Plugin, "load Coach");
      expect(result).toContain("Loaded template **Coach** into chat input.");
      expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
      dispatchSpy.mockRestore();
    });

    it("should save template", async () => {
      const tplCmd = getSlashCommands().find((c) => c.name === "template");
      const mockView = {
        activeMessages: [{ role: "user", content: "Design a system prompt" }],
      };
      mockPlugin.app.workspace.getLeavesOfType.mockReturnValue([
        { view: mockView },
      ]);

      const result = await tplCmd!.execute(
        mockPlugin as Plugin,
        "save my-coach",
      );
      expect(result).toContain("Template **my-coach** saved successfully.");
      expect(mockPlugin.templateManager.saveTemplate).toHaveBeenCalledWith(
        "my-coach",
        "Design a system prompt",
      );
    });
  });

  describe("/pdf command", () => {
    it("should extract page text", async () => {
      const pdfCmd = getSlashCommands().find((c) => c.name === "pdf");
      expect(pdfCmd).toBeDefined();

      const mockFile = makeTFile("papers/doc.pdf", "pdf");
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const result = await pdfCmd!.execute(
        mockPlugin as Plugin,
        "page papers/doc.pdf 1",
      );
      expect(result).toContain("### 📄 Extracted Text from doc (Page 1)");
      expect(result).toContain("Mock page text");
    });

    it("should extract metadata", async () => {
      const pdfCmd = getSlashCommands().find((c) => c.name === "pdf");
      const mockFile = makeTFile("papers/doc.pdf", "pdf");
      mockPlugin.app.vault.getAbstractFileByPath.mockReturnValue(mockFile);

      const result = await pdfCmd!.execute(
        mockPlugin as Plugin,
        "metadata papers/doc.pdf",
      );
      expect(result).toContain("### 📋 Metadata for doc");
      expect(result).toContain("**Title:** Mock PDF");
    });
  });

  describe("Feature Toggles", () => {
    it("should respect enableCitations = false", async () => {
      const citeCmd = getSlashCommands().find((c) => c.name === "cite");
      mockPlugin.settings.enableCitations = false;

      const result = await citeCmd!.execute(mockPlugin as Plugin, "style apa");
      expect(result).toBe("Citations feature is disabled in settings.");
    });

    it("should respect enableAnnotations = false for /annotations", async () => {
      const annotCmd = getSlashCommands().find((c) => c.name === "annotations");
      mockPlugin.settings.enableAnnotations = false;

      const result = await annotCmd!.execute(mockPlugin as Plugin, "paper.pdf");
      expect(result).toBe("PDF integrations are disabled in settings.");
    });

    it("should respect enableAnnotations = false for /pdf", async () => {
      const pdfCmd = getSlashCommands().find((c) => c.name === "pdf");
      mockPlugin.settings.enableAnnotations = false;

      const result = await pdfCmd!.execute(
        mockPlugin as Plugin,
        "metadata paper.pdf",
      );
      expect(result).toBe("PDF integrations are disabled in settings.");
    });

    it("should respect enableTags = false", async () => {
      const tagsCmd = getSlashCommands().find((c) => c.name === "tags");
      mockPlugin.settings.enableTags = false;

      const result = await tagsCmd!.execute(mockPlugin as Plugin, "suggest");
      expect(result).toBe("Tags suggestion feature is disabled in settings.");
    });
  });
});
