/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAutocomplete } from "../Views/Hooks/useAutocomplete.ts";

describe("useAutocomplete", () => {
  it("should initialize with default states", () => {
    const { result } = renderHook(() => useAutocomplete());

    expect(result.current.autocompleteQuery).toBe("");
    expect(result.current.autocompleteSuggestions).toEqual([]);
    expect(result.current.isAutocompleteOpen).toBe(false);
  });

  it("should cycle suggestions correctly", () => {
    const { result } = renderHook(() => useAutocomplete());

    act(() => {
      result.current.setAutocompleteSuggestions([
        { id: "1", text: "a", type: "note" },
        { id: "2", text: "b", type: "note" },
      ]);
    });

    act(() => {
      result.current.cycleSuggestions("next");
    });
    expect(result.current.autocompleteSelectionIndex).toBe(1);

    act(() => {
      result.current.cycleSuggestions("next");
    });
    expect(result.current.autocompleteSelectionIndex).toBe(0);
  });
});
