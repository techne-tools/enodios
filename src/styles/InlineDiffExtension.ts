import type { DecorationSet } from '@codemirror/view';

import {
 StateEffect,
StateField
} from '@codemirror/state';
import {
 Decoration,
EditorView,
WidgetType
} from '@codemirror/view';

import type { DiffLineState } from '../FileChangeManager.ts';

/**
 * Inline Diff Extension for CodeMirror 6
 *
 * Renders file changes (additions, deletions) inline in the markdown editor
 * with visual markers (+/-) and optional line highlighting.
 *
 * ARCHITECTURE:
 * - InlineDiffWidget: Renders a single diff line with +/- marker and styling.
 * - InlineDiffState: Holds the diff lines and target position in the document.
 * - inlineDiffStateField: CodeMirror StateField that manages DecorationSet.
 *
 * USAGE:
 * 1. Compute diff lines using FileChangeManager.computeDiffLines()
 * 2. Find the target position in the document (e.g., start of modified section)
 * 3. Dispatch setInlineDiffEffect with diff lines and position
 * 4. Diff lines render inline with the editor content
 */

interface InlineDiffState {
  lines: DiffLineState[];
  startPos: number;
}

/**
 * Custom CodeMirror 6 Widget to render a single diff line inline.
 * Uses CSS classes for styling:
 * - hermes-diff-line: Container
 * - hermes-diff-added: Green background for additions
 * - hermes-diff-removed: Red background for deletions
 * - hermes-diff-marker: +/- prefix
 * - hermes-diff-text: Actual line content
 */
class InlineDiffWidget extends WidgetType {
  constructor(public readonly line: DiffLineState) {
    super();
  }

  override eq(other: InlineDiffWidget): boolean {
    return this.line.line === other.line.line && this.line.type === other.line.type;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'hermes-diff-line hermes-diff-' + this.line.type;
    
    const marker = document.createElement('span');
    marker.className = 'hermes-diff-marker';
    marker.textContent = this.line.type === 'added' ? '+' : this.line.type === 'removed' ? '-' : ' ';
    span.appendChild(marker);
    
    const text = document.createElement('span');
    text.className = 'hermes-diff-text';
    text.textContent = this.line.line;
    span.appendChild(text);
    
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** StateEffect to set or clear inline diff. Null = clear. */
export const setInlineDiffEffect = StateEffect.define<InlineDiffState | null>();

/**
 * CodeMirror StateField that manages inline diff decorations.
 * Maps decorations across document changes and handles set/clear effects.
 */
export const inlineDiffStateField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  provide: (f) => EditorView.decorations.from(f),
  update(value, tr) {
    // Shift decorations if the document changed
    value = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setInlineDiffEffect)) {
        if (effect.value === null) {
          return Decoration.none; // Clear diff
        }
        const { lines, startPos } = effect.value;
        const ranges: any[] = [];
        
        let currentPos = startPos;
        for (const line of lines) {
          const widget = Decoration.widget({
            side: 1,
            widget: new InlineDiffWidget(line)
          });
          ranges.push(widget.range(currentPos));
          // Each diff line takes up one "virtual" position
          currentPos += 1;
        }
        
        return Decoration.set(ranges);
      }
    }

    // Clear the diff if the user types anything
    if (tr.docChanged && !tr.effects.some((e) => e.is(setInlineDiffEffect))) {
      return Decoration.none;
    }

    return value;
  }
});

/**
 * CodeMirror 6 extension that provides inline diff rendering.
 */
export const inlineDiffExtension = inlineDiffStateField;

/**
 * Apply inline diff to the current editor view.
 * Finds the active markdown view and applies the diff at the current cursor position.
 */
export function applyInlineDiff(view: EditorView, lines: DiffLineState[]): void {
  const startPos = view.state.selection.main.from;
  view.dispatch({
    effects: setInlineDiffEffect.of({ lines, startPos })
  });
}

/**
 * Clear inline diff from the current editor view.
 */
export function clearInlineDiff(view: EditorView): void {
  view.dispatch({
    effects: setInlineDiffEffect.of(null)
  });
}
