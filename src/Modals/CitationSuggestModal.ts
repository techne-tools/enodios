import { FuzzySuggestModal, MarkdownView } from 'obsidian';
import type { Plugin } from '../Plugin.ts';
import type { CitationItem } from '../CitationManager.ts';

/**
 * Fuzzy suggest modal for selecting and inserting citations in active editor.
 */
export class CitationSuggestModal extends FuzzySuggestModal<CitationItem> {
  private readonly items: CitationItem[];

  constructor(plugin: Plugin, items: CitationItem[]) {
    super(plugin.app);
    this.items = items;
    this.setPlaceholder('Type to search bibliography...');
  }

  public getItems(): CitationItem[] {
    return this.items;
  }

  public getItemText(item: CitationItem): string {
    return `${item.key} — ${item.title} (${item.author}, ${item.year})`;
  }

  public onChooseItem(item: CitationItem, _evt: MouseEvent | KeyboardEvent): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const editor = activeView.editor;
      editor.replaceSelection(`[@${item.key}]`);
    }
  }
}
