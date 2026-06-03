import type { DecorationSet } from '@codemirror/view';

import {
 Range,
 StateEffect,
StateField
} from '@codemirror/state';
import {
 Decoration,
EditorView,
WidgetType
} from '@codemirror/view';

import type { DiffLineState, FileChangeManager } from '../FileChangeManager.ts';

interface InlineDiffState {
  changeId: string;
  lines: DiffLineState[];
  manager: FileChangeManager;
}

class FileHeaderWidget extends WidgetType {
  constructor(private changeId: string, private manager: FileChangeManager) { super(); }
  
  override eq(other: FileHeaderWidget) { return this.changeId === other.changeId; }
  
  toDOM() {
    const div = document.createElement('div');
    div.className = 'hermes-diff-file-header';
    // NOTE: "Approve All" / "Reject All" here refers to ALL hunks within
    // this single file change, not all pending changes globally. The UI
    // presents one file header per pending change, so "All" is scoped
    // to the current file's hunks.
    div.innerHTML = `
      <div class="hermes-diff-file-title">Pending Changes</div>
      <div class="hermes-diff-actions">
        <button class="hermes-btn-approve">Approve All</button>
        <button class="hermes-btn-reject">Reject All</button>
      </div>
    `;
    div.querySelector('.hermes-btn-approve')!.addEventListener('click', () => {
      this.manager.approveChange(this.changeId);
    });
    div.querySelector('.hermes-btn-reject')!.addEventListener('click', () => {
      this.manager.rejectChange(this.changeId);
    });
    return div;
  }
}

class HunkHeaderWidget extends WidgetType {
  constructor(private changeId: string, private indices: number[], private manager: FileChangeManager) { super(); }
  
  override eq(other: HunkHeaderWidget) { 
    return this.changeId === other.changeId && this.indices.join(',') === other.indices.join(','); 
  }
  
  toDOM() {
    const div = document.createElement('div');
    div.className = 'hermes-diff-hunk-header';
    div.innerHTML = `
      <div class="hermes-diff-actions">
        <button class="hermes-btn-approve-sm">Approve Hunk</button>
        <button class="hermes-btn-reject-sm">Reject Hunk</button>
      </div>
    `;
    div.querySelector('.hermes-btn-approve-sm')!.addEventListener('click', () => {
      this.manager.applyPartialHunk(this.changeId, this.indices);
    });
    div.querySelector('.hermes-btn-reject-sm')!.addEventListener('click', () => {
      this.manager.rejectPartialHunk(this.changeId, this.indices);
    });
    return div;
  }
}

class InlineDiffWidget extends WidgetType {
  constructor(public readonly line: DiffLineState) { super(); }

  override eq(other: InlineDiffWidget): boolean {
    return this.line.line === other.line.line && this.line.type === other.line.type;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('div');
    span.className = 'hermes-diff-line hermes-diff-' + this.line.type;

    const marker = document.createElement('span');
    marker.className = 'hermes-diff-marker';
    marker.textContent = this.line.type === 'added' ? '+' : this.line.type === 'removed' ? '-' : ' ';
    span.appendChild(marker);

    const text = document.createElement('span');
    text.className = 'hermes-diff-text';
    text.textContent = this.line.line || ' ';
    span.appendChild(text);

    return span;
  }

  override ignoreEvent(): boolean { return false; }
}

export const setInlineDiffEffect = StateEffect.define<InlineDiffState | null>();

export const inlineDiffStateField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  provide: (f) => EditorView.decorations.from(f),
  update(value, tr) {
    value = value.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setInlineDiffEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }
        const { lines, changeId, manager } = effect.value;
        const ranges: Range<Decoration>[] = [];
        const doc = tr.state.doc;
        
        let docLine = 1;
        let currentHunkIndices: number[] = [];
        
        const flushHunk = () => {
          if (currentHunkIndices.length > 0) {
            // Find the position. We insert the hunk header above the FIRST changed line.
            // Wait, we can just insert it at the current docLine's start position.
            // Since we increment docLine for unchanged and removed lines, we need to subtract the number of removed lines in this hunk to get to the START of the hunk in the document.
            const removedLines = currentHunkIndices.filter(i => lines[i]?.type === 'removed').length;
            const targetLine = Math.max(1, docLine - removedLines);
            const pos = targetLine <= doc.lines ? doc.line(targetLine).from : doc.length;
            
            ranges.push(Decoration.widget({
              widget: new HunkHeaderWidget(changeId, [...currentHunkIndices], manager),
              block: true,
              side: -2 // Above added lines and removed lines
            }).range(pos));
            
            currentHunkIndices = [];
          }
        };

        // File Header at top of document
        ranges.push(Decoration.widget({
          widget: new FileHeaderWidget(changeId, manager),
          block: true,
          side: -3 // Very top
        }).range(0));

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          if (line.type === 'unchanged') {
            flushHunk();
            if (docLine <= doc.lines) docLine++;
          } else {
            currentHunkIndices.push(i);
            if (line.type === 'removed') {
               if (docLine <= doc.lines) {
                 const lineStart = doc.line(docLine).from;
                 const lineEnd = doc.line(docLine).to;
                 
                 // Replace the original line text so it's hidden
                 ranges.push(Decoration.replace({}).range(lineStart, lineEnd));
                 
                 // Insert our custom diff block widget
                 ranges.push(Decoration.widget({
                   widget: new InlineDiffWidget(line),
                   block: true,
                   side: -1
                 }).range(lineStart));
                 
                 docLine++;
               }
            } else if (line.type === 'added') {
               const pos = docLine <= doc.lines ? doc.line(docLine).from : doc.length;
               ranges.push(Decoration.widget({
                 widget: new InlineDiffWidget(line),
                 block: true,
                 side: -1
               }).range(pos));
            }
          }
        }
        flushHunk();

        // Sort is necessary because we add out-of-order when backtracking for flushHunk
        ranges.sort((a, b) => {
          if (a.from !== b.from) return a.from - b.from;
          // Sort by side if positions match
          // Note: Decoration.widget internal side is not exposed on `Range` object easily.
          return 0; 
        });

        return Decoration.set(ranges, true);
      }
    }

    if (tr.docChanged && !tr.effects.some((e) => e.is(setInlineDiffEffect))) {
      if (tr.isUserEvent('input') || tr.isUserEvent('delete')) {
        return Decoration.none;
      }
    }

    return value;
  }
});

export const inlineDiffExtension = inlineDiffStateField;

export function clearInlineDiff(view: EditorView): void {
  view.dispatch({
    effects: setInlineDiffEffect.of(null)
  });
}
