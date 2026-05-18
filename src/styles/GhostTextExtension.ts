import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';

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
interface GhostTextState {
  alternatives: string[];
  currentIndex: number;
  pos: number;
}

/**
 * Custom CodeMirror 6 Widget to render ghost text inline with alternatives indicator.
 * Uses CSS class 'hermes-ghost-text' for translucent styling.
 */
class GhostTextWidget extends WidgetType {
  constructor(public readonly text: string, public readonly currentIndex: number, public readonly total: number) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'hermes-ghost-text';
    span.textContent = this.text;
    if (this.total > 1) {
      span.setAttribute('data-alternatives', `${this.currentIndex + 1}/${this.total}`);
    }
    return span;
  }

  override eq(other: GhostTextWidget): boolean {
    return this.text === other.text && this.currentIndex === other.currentIndex && this.total === other.total;
  }
}

/** StateEffect to set or clear ghost text. Null = clear. */
export const setGhostTextEffect = StateEffect.define<GhostTextState | null>();

/**
 * CodeMirror StateField that manages ghost text decorations.
 * Maps decorations across document changes and handles set/clear effects.
 */
export const ghostTextStateField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  provide: (f) => EditorView.decorations.from(f),
  update(value, tr) {
    // Shift decorations if the document changed (e.g. typing)
    value = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setGhostTextEffect)) {
        if (effect.value === null) {
          return Decoration.none; // Clear suggestion
        }
        const { alternatives, currentIndex, pos } = effect.value;
        const text = alternatives[currentIndex] ?? alternatives[0] ?? '';
        const widget = Decoration.widget({
          side: 1, // Render after the cursor
          widget: new GhostTextWidget(text, currentIndex, alternatives.length)
        });
        return Decoration.set([widget.range(pos)]);
      }
    }

    // Clear the ghost text if the user types anything and we didn't just explicitly set it
    if (tr.docChanged && !tr.effects.some((e) => e.is(setGhostTextEffect))) {
      return Decoration.none;
    }

    return value;
  }
});

/**
 * Keymap for ghost text interactions.
 * - Tab: Accept the current suggestion (insert text, clear decoration).
 * - Alt+ArrowRight: Cycle to next alternative (clears current; plugin must re-dispatch).
 */
export const ghostTextKeymap = keymap.of([
  {
    key: 'Tab',
    run: (view: EditorView) => {
      const field = view.state.field(ghostTextStateField, false);
      if (!field) return false;

      let accepted = false;
      field.between(0, view.state.doc.length, (from, _to, value) => {
        const widget = value.spec.widget as GhostTextWidget;
        if (widget) {
          // Insert the text and clear the decoration
          view.dispatch({
            changes: { from, insert: widget.text, to: from },
            effects: setGhostTextEffect.of(null)
          });
          accepted = true;
          return false;
        }
        return;
      });

      return accepted; // Return true to prevent default Tab behavior if we handled it
    }
  },
  {
    key: 'Alt-ArrowRight',
    run: (view: EditorView) => {
      const field = view.state.field(ghostTextStateField, false);
      if (!field) return false;

      let cycled = false;
      field.between(0, view.state.doc.length, (_from, _to, value) => {
        const widget = value.spec.widget as GhostTextWidget;
        if (widget && widget.total > 1) {
          // We need to cycle to the next alternative
          // Since we don't store the full state in the widget, we dispatch a new effect
          // The plugin will need to handle cycling externally
          // For now, just clear the ghost text
          view.dispatch({
            effects: setGhostTextEffect.of(null)
          });
          cycled = true;
          return false;
        }
        return;
      });

      return cycled;
    }
  }
]);

/** Combined extension to register with CodeMirror. */
export const ghostTextExtension = [ghostTextStateField, ghostTextKeymap];
