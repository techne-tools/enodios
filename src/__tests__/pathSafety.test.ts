import { describe, expect, it } from "vitest";
import { isLexicallySafePath, isPathSafe } from "../utils/pathSafety.ts";
import type { Plugin } from "../Plugin.ts";

describe("isLexicallySafePath", () => {
  it("allows normal relative file paths", () => {
    expect(isLexicallySafePath("notes/todo.md")).toBe(true);
    expect(isLexicallySafePath("daily/2026-11-11.md")).toBe(true);
    expect(isLexicallySafePath("readme.md")).toBe(true);
  });

  it("rejects parent directory traversal", () => {
    expect(isLexicallySafePath("../secret.txt")).toBe(false);
    expect(isLexicallySafePath("notes/../../secret.txt")).toBe(false);
    expect(isLexicallySafePath("..")).toBe(false);
  });

  it("rejects absolute paths", () => {
    expect(isLexicallySafePath("/etc/passwd")).toBe(false);
    expect(isLexicallySafePath("/Users/alice")).toBe(false);
  });

  it("rejects control characters and null bytes", () => {
    expect(isLexicallySafePath("file\u0000.md")).toBe(false);
    expect(isLexicallySafePath("file\u001f.md")).toBe(false);
  });

  it("rejects Windows drive letters and UNC paths", () => {
    expect(isLexicallySafePath("C:\\Windows\\System32")).toBe(false);
    expect(isLexicallySafePath("D:/notes")).toBe(false);
    expect(isLexicallySafePath("\\\\server\\share\\note.md")).toBe(false);
  });
});

describe("isPathSafe", () => {
  it("falls back to lexical safety when no getBasePath is available", async () => {
    const mockPlugin = {
      app: {
        vault: {
          adapter: {},
        },
      },
    } as unknown as Plugin;

    expect(await isPathSafe(mockPlugin, "notes/test.md")).toBe(true);
    expect(await isPathSafe(mockPlugin, "../escape.md")).toBe(false);
  });
});
