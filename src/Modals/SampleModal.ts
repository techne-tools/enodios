import { Modal } from 'obsidian';

export class HermesModal extends Modal {
  public override onOpen(): void {
    this.contentEl.setText('Sample modal');
  }
}
