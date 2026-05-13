import { ItemView } from 'obsidian';
import { mount } from 'svelte';

import SampleSvelteComponent from '../SvelteComponents/SampleSvelteComponent.svelte';

export const SAMPLE_SVELTE_VIEW_TYPE = 'hermes-SampleSvelteView';

export class SampleSvelteView extends ItemView {
  private sampleSvelteComponent: { $destroy(): void; increment(): void } | null = null;

  public override getDisplayText(): string {
    return 'Sample Svelte view';
  }

  public override getViewType(): string {
    return SAMPLE_SVELTE_VIEW_TYPE;
  }

  public override onClose(): Promise<void> {
    if (this.sampleSvelteComponent) {
      this.sampleSvelteComponent.$destroy();
    }
    return Promise.resolve();
  }

  public override onOpen(): Promise<void> {
    const START_COUNT = 10;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Svelte component mount return type
    this.sampleSvelteComponent = mount(SampleSvelteComponent, {
      props: { startCount: START_COUNT },
      target: this.contentEl
    }) as { $destroy(): void; increment(): void };

    this.sampleSvelteComponent.increment();
    return Promise.resolve();
  }
}
