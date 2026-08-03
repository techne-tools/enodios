/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSlashCommands } from "../Views/Hooks/useSlashCommands.ts";

// SlashCommands pulls in Obsidian APIs; mock just the registry pieces the hook uses.
vi.mock("../SlashCommands.ts", () => ({
  getSlashCommands: () => [
    { name: "clear", description: "Clear the conversation" },
    { name: "clip", description: "Copy last response to clipboard" },
    { name: "save", description: "Save the conversation" },
  ],
  parseSlashCommand: (text: string) => {
    const name = text.slice(1).split(" ")[0];
    return { args: text.slice(name.length + 1).trim(), name };
  },
}));

// Mocking dependencies
const mockTextareaRef = {
  current: document.createElement("textarea"),
} as React.RefObject<HTMLTextAreaElement>;

describe("useSlashCommands", () => {
  it("should initialize with default states", () => {
    const { result } = renderHook(() =>
      useSlashCommands(() => {}, mockTextareaRef),
    );

    expect(result.current.slashSuggestions).toEqual([]);
    expect(result.current.isSlashOpen).toBe(false);
    expect(result.current.activeCommand).toBe(null);
  });

  it("should detect slash commands and filter suggestions", () => {
    const { result } = renderHook(() =>
      useSlashCommands(() => {}, mockTextareaRef),
    );

    act(() => {
      result.current.handleSlashInput("/cl");
    });

    expect(result.current.isSlashOpen).toBe(true);
    // Assuming 'clear' is a valid slash command
    expect(
      result.current.slashSuggestions.some((cmd) => cmd.name === "clear"),
    ).toBe(true);
  });

  it("should close slash menu on Escape", () => {
    const { result } = renderHook(() =>
      useSlashCommands(() => {}, mockTextareaRef),
    );

    // Open it first
    act(() => {
      result.current.handleSlashInput("/cl");
    });
    expect(result.current.isSlashOpen).toBe(true);

    // Escape
    const event = {
      key: "Escape",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
    act(() => {
      result.current.handleSlashKeyDown(event);
    });

    expect(result.current.isSlashOpen).toBe(false);
  });
});
