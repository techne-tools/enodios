import type { DecorationSet } from '@codemirror/view';

import {
 StateEffect,
StateField
} from '@codemirror/state';
import {
 Decoration,

EditorView,
keymap,
WidgetType
} from '@codemirror/view';

/**
 * Ghost Text Inline Suggestions for CodeMirror 6
 *
 * Provides Copilot-style inline auto-completion directly in the markdown editor.
 * Supports multiple alternatives that can be cycled with Alt+ArrowRight.
 *
 * ARCHITECTURE:
 * - GhostTextState: Holds the suggestion text, position, and alternatives array.
 * - GhostTextWidget: Renders the ghost text as a translucent inline span.
 * - ghostTextStateField: CodeMirror StateField that manages the DecorationSet.
 * - ghostTextKeymap: Intercepts Tab (accept) and Alt+ArrowRight (cycle).
 *
 * LIFECYCLE:
 * 1. Plugin triggers inline completion → dispatches setGhostTextEffect with alternatives.
 * 2. StateField creates a Decoration.widget at the cursor position.
 * 3. User presses Tab → text is inserted, decoration cleared.
 * 4. User types or moves cursor → decoration auto-clears.
 *
 * NOTE: Alternative cycling requires external state management.
 * The current implementation clears the ghost text on Alt+ArrowRight;
 * the plugin is responsible for re-dispatching with the next alternative.
 */
export interface GhostTextState {
  alternatives: string[];
  currentIndex: number;
  pos: number;
}

export interface GhostTextStateValue {
  decorations: DecorationSet;
  state: GhostTextState | null;
}

/**
 * Custom CodeMirror 6 Widget to render ghost text inline with alternatives indicator.
 * Uses CSS class 'enodios-ghost-text' for translucent styling.
 */
class GhostTextWidget extends WidgetType {
  constructor(public readonly text: string, public readonly currentIndex: number, public readonly total: number) {
    super();
  }

  override eq(other: GhostTextWidget): boolean {
    return this.text === other.text && this.currentIndex === other.currentIndex && this.total === other.total;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'enodios-ghost-text';
    span.textContent = this.text;
    if (this.total > 1) {
      span.setAttribute('data-alternatives', `${this.currentIndex + 1}/${this.total}`);
    }
    return span;
  }
}

/** StateEffect to set or clear ghost text. Null = clear. */
export const setGhostTextEffect = StateEffect.define<GhostTextState | null>();

/**
 * CodeMirror StateField that manages ghost text decorations.
 * Maps decorations across document changes and handles set/clear effects.
 */
export const ghostTextStateField = StateField.define<GhostTextStateValue>({
  create() {
    return { decorations: Decoration.none, state: null };
  },
  provide: (f) => EditorView.decorations.from(f, (val) => val.decorations),
  update(value, tr) {
    let { decorations, state } = value;
    decorations = decorations.map(tr.changes);
    if (state) {
      state = {
        ...state,
        pos: tr.changes.mapPos(state.pos)
      };
    }

    for (const effect of tr.effects) {
      if (effect.is(setGhostTextEffect)) {
        if (effect.value === null) {
          return { decorations: Decoration.none, state: null };
        }
        const { alternatives, currentIndex, pos } = effect.value;
        const text = alternatives[currentIndex] ?? alternatives[0] ?? '';
        const widget = Decoration.widget({
          side: 1, // Render after the cursor
          widget: new GhostTextWidget(text, currentIndex, alternatives.length)
        });
        return {
          decorations: Decoration.set([widget.range(pos)]),
          state: effect.value
        };
      }
    }

    // Clear the ghost text if the user types anything and we didn't just explicitly set it
    if (tr.docChanged && !tr.effects.some((e) => e.is(setGhostTextEffect))) {
      return { decorations: Decoration.none, state: null };
    }

    return { decorations, state };
  }
});

/**
 * Keymap for ghost text interactions.
 * - Tab: Accept the current suggestion (insert text, clear decoration).
 * - Alt+ArrowRight: Cycle to next alternative.
 * - Alt+ArrowLeft: Cycle to previous alternative.
 */
export const ghostTextKeymap = keymap.of([
  {
    key: 'Tab',
    run: (view: EditorView) => {
      const fieldVal = view.state.field(ghostTextStateField, false);
      if (!fieldVal || !fieldVal.state) { return false; }

      const { alternatives, currentIndex, pos } = fieldVal.state;
      const text = alternatives[currentIndex];
      if (text) {
        // Insert the text and clear the decoration
        view.dispatch({
          changes: { from: pos, insert: text, to: pos },
          effects: setGhostTextEffect.of(null)
        });
        return true;
      }

      return false;
    }
  },
  {
    key: 'Alt-ArrowRight',
    run: (view: EditorView) => {
      const fieldVal = view.state.field(ghostTextStateField, false);
      if (!fieldVal || !fieldVal.state) { return false; }

      const { alternatives, currentIndex, pos } = fieldVal.state;
      if (alternatives.length > 1) {
        const nextIndex = (currentIndex + 1) % alternatives.length;
        view.dispatch({
          effects: setGhostTextEffect.of({
            alternatives,
            currentIndex: nextIndex,
            pos
          })
        });
        return true;
      }

      return false;
    }
  },
  {
    key: 'Alt-ArrowLeft',
    run: (view: EditorView) => {
      const fieldVal = view.state.field(ghostTextStateField, false);
      if (!fieldVal || !fieldVal.state) { return false; }

      const { alternatives, currentIndex, pos } = fieldVal.state;
      if (alternatives.length > 1) {
        const nextIndex = (currentIndex - 1 + alternatives.length) % alternatives.length;
        view.dispatch({
          effects: setGhostTextEffect.of({
            alternatives,
            currentIndex: nextIndex,
            pos
          })
        });
        return true;
      }

      return false;
    }
  }
]);

/** Combined extension to register with CodeMirror. */
export const ghostTextExtension = [ghostTextStateField, ghostTextKeymap];
