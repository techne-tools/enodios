import { TFile } from "obsidian";

import type { Plugin } from "../Plugin.ts";

/**
 * Represents a parsed block-level reference within a markdown document.
 * Used for smart context embedding — sending only relevant sections
 * instead of entire notes to the agent.
 */
export interface BlockReference {
  /** The extracted text content of this block */
  content: string;
  /** Zero-based end line index (inclusive) */
  endLine: number;
  /** Zero-based start line index */
  startLine: number;
  /** Classification of the block type */
  type: "block-id" | "code-block" | "heading" | "list" | "paragraph";
}

/**
 * Extract a specific block from a note by heading name.
 * Returns the full note content if heading not found.
 */
export function extractBlockByHeading(
  content: string,
  heading: string,
): string {
  const blocks = parseBlockReferences(content);
  const target = heading.toLowerCase().trim();
  const match = blocks.find(
    (b) => b.type === "heading" && b.content.toLowerCase().includes(target),
  );
  return match?.content ?? content;
}

/**
 * Extract a specific block from a note by line range.
 */
export function extractBlockByRange(
  content: string,
  startLine: number,
  endLine: number,
): string {
  const lines = content.split("\n");
  return lines.slice(startLine, endLine + 1).join("\n");
}

/**
 * Parse a note to extract block-level references.
 * Supports:
 * - Headings: `[[Note#Heading]]` or `## Heading`
 * - Code blocks: fenced code blocks (```)
 * - Lists: bullet/numbered lists (single item or range with indentation)
 * - Block IDs: `^block-id` references
 * - Paragraphs: contiguous non-empty text between structural elements
 *
 * SECURITY NOTE: This is a pure parser — it does not execute or evaluate
 * any code within blocks. All content is treated as plain text.
 */
export function parseBlockReferences(content: string): BlockReference[] {
  const lines = content.split("\n");
  const blocks: BlockReference[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }

    // Heading: match # through ###### and collect until next heading
    // Of same or higher level (lower number = higher level)
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 0;
      const startLine = i;
      i++;
      // Collect until next heading of same or higher level
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined) {
          break;
        }
        const nextHeading = /^(#{1,6})\s+/.exec(nextLine);
        if (nextHeading && (nextHeading[1]?.length ?? 0) <= level) {
          break;
        }
        i++;
      }
      blocks.push({
        content: lines.slice(startLine, i).join("\n"),
        endLine: i - 1,
        startLine,
        type: "heading",
      });
      continue;
    }

    // Code block: match opening ``` and collect until closing ```
    // Handles optional language specifier (e.g., ```typescript)
    const codeFenceMatch = /^```(\w*)/.exec(line);
    if (codeFenceMatch) {
      const startLine = i;
      i++;
      while (i < lines.length) {
        const fenceLine = lines[i];
        if (fenceLine === undefined || fenceLine.startsWith("```")) {
          break;
        }
        i++;
      }
      if (i < lines.length) {
        i++;
      } // Include closing ```
      blocks.push({
        content: lines.slice(startLine, i).join("\n"),
        endLine: i - 1,
        startLine,
        type: "code-block",
      });
      continue;
    }

    // List item: match bullet (-, *, +) or numbered (1., 2., etc.)
    // Collect continuation lines (indented more or blank lines)
    const listMatch = /^(\s*)([-*+]|\d+\.)\s+/.exec(line);
    if (listMatch) {
      const startLine = i;
      const indent = listMatch[1]?.length ?? 0;
      i++;
      // Continue while next lines are continuations (indented more or blank)
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined) {
          break;
        }
        if (nextLine.trim() === "") {
          i++;
          continue;
        }
        const nextIndent = /^(\s*)/.exec(nextLine)?.[1]?.length ?? 0;
        const nextList = /^(\s*)([-*+]|\d+\.)\s+/.exec(nextLine);
        if (nextList) {
          if (nextIndent > indent) {
            i++;
            continue;
          }
          // Same or less indent = new list item, stop
          break;
        }
        if (nextIndent > indent) {
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        content: lines.slice(startLine, i).join("\n"),
        endLine: i - 1,
        startLine,
        type: "list",
      });
      continue;
    }

    // Block ID reference: ^block-id on its own line
    // Attach to the previous non-empty line as the block content
    const blockIdMatch = /\^([a-zA-Z0-9_-]+)$/.exec(line);
    if (blockIdMatch) {
      // Find the block this ID is attached to (previous non-empty line)
      let blockStart = i - 1;
      while (blockStart >= 0) {
        const prevLine = lines[blockStart];
        if (prevLine === undefined || prevLine.trim() !== "") {
          break;
        }
        blockStart--;
      }
      if (blockStart >= 0) {
        const blockContent = lines[blockStart];
        if (blockContent !== undefined) {
          blocks.push({
            content: blockContent,
            endLine: blockStart,
            startLine: blockStart,
            type: "block-id",
          });
        }
      }
      i++;
      continue;
    }

    // Paragraph: contiguous non-empty text until next structural element
    // Skip empty lines — they don't start paragraphs
    if (line.trim() !== "") {
      const startLine = i;
      i++;
      while (i < lines.length) {
        const paraLine = lines[i];
        if (paraLine === undefined || paraLine.trim() === "") {
          break;
        }
        if (/^(#{1,6}\s|```|\s*[-*+]|\s*\d+\.|\^)/.exec(paraLine)) {
          break;
        }
        i++;
      }
      const firstLine = lines[startLine];
      if (
        startLine !== i - 1 ||
        (firstLine !== undefined && firstLine.trim() !== "")
      ) {
        blocks.push({
          content: lines.slice(startLine, i).join("\n"),
          endLine: i - 1,
          startLine,
          type: "paragraph",
        });
      }
      continue;
    }

    i++;
  }

  return blocks;
}

/**
 * Resolve a wikilink with optional block reference to content.
 * Supports:
 * - [[Note]] → full note
 * - [[Note#Heading]] → heading section
 * - [[Note#^block-id]] → block by ID
 */
export async function resolveBlockReference(
  plugin: Plugin,
  link: string,
): Promise<{
  content: string;
  path: string;
  type: "block-id" | "full" | "heading";
} | null> {
  // Parse [[path#heading]] or [[path#^block-id]]
  const match = /^\[\[(.+?)(?:#(.+?))?\]\]$/.exec(link);
  if (!match) {
    return null;
  }

  const notePath = match[1] ?? "";
  const blockRef = match[2];

  const file = plugin.app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) {
    return null;
  }

  const content = await plugin.app.vault.read(file);

  if (!blockRef) {
    return { content, path: notePath, type: "full" };
  }

  if (blockRef.startsWith("^")) {
    // Block ID reference
    const blockId = blockRef.slice(1);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.endsWith(`^${blockId}`)) {
        // Find the start of this block
        let start = i;
        while (start > 0) {
          const prevLine = lines[start - 1];
          if (prevLine === undefined || prevLine.trim() === "") {
            break;
          }
          start--;
        }
        return {
          content: lines.slice(start, i + 1).join("\n"),
          path: notePath,
          type: "block-id",
        };
      }
    }
    return { content, path: notePath, type: "full" };
  }

  // Heading reference
  const headingContent = extractBlockByHeading(content, blockRef);
  return {
    content: headingContent,
    path: notePath,
    type: "heading",
  };
}
