import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

import type { IEmbeddingClient } from './EmbeddingClient.ts';

import { SemanticSearchIndex } from './SemanticSearchIndex.ts';

/**
 * Stub embedding client that maps each text to a deterministic vector
 * (hash of the text into 4 dims) so cosine rankings are meaningful.
 */
class StubEmbeddingClient implements IEmbeddingClient {
  public readonly calls: string[][] = [];

  public async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map((t) => this.vectorFor(t));
  }

  public async isReady(): Promise<boolean> {
    return true;
  }

  private vectorFor(text: string): number[] {
    let seed = 0;
    for (const ch of text) {
      seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    }
    return [
      (seed & 0xff) / 255,
      ((seed >> 8) & 0xff) / 255,
      ((seed >> 16) & 0xff) / 255,
      ((seed >> 24) & 0xff) / 255
    ];
  }
}

describe('SemanticSearchIndex', () => {
  let embeddingClient: StubEmbeddingClient;
  let index: SemanticSearchIndex;

  beforeEach(() => {
    embeddingClient = new StubEmbeddingClient();
    index = new SemanticSearchIndex(embeddingClient);
  });

  it('should index a note and store its embedding', async () => {
    await index.indexNote('note-a.md', 'sound design for theatre');

    const results = await index.search('sound design');
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('note-a.md');
  });

  it('should rank notes by cosine similarity, descending', async () => {
    await index.indexNote('unrelated.md', 'tax returns and spreadsheets');
    await index.indexNote('related.md', 'acoustic ecology and field recording');
    await index.indexNote('exact.md', 'sound design methodology');

    const results = await index.search('sound design methodology', 5);

    expect(results.map((r) => r.path)).toEqual([
      'exact.md',
      'related.md',
      'unrelated.md'
    ]);
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1];
      const cur = results[i];
      if (prev && cur) {
        expect(prev.score).toBeGreaterThanOrEqual(cur.score);
      }
    }
  });

  it('should respect topK', async () => {
    for (let i = 0; i < 10; i++) {
      await index.indexNote(`note-${i}.md`, `content ${i} about sound`);
    }

    const results = await index.search('sound', 3);

    expect(results).toHaveLength(3);
  });

  it('should return an empty array when nothing is indexed', async () => {
    const results = await index.search('anything');
    expect(results).toEqual([]);
  });

  it('content-hash guard: re-indexing unchanged content is a no-op', async () => {
    await index.indexNote('note-a.md', 'unchanged content');
    const embedCallsAfterFirst = embeddingClient.calls.length;

    await index.indexNote('note-a.md', 'unchanged content');

    expect(embeddingClient.calls.length).toBe(embedCallsAfterFirst);
  });

  it('content-hash guard: re-indexing changed content re-embeds', async () => {
    await index.indexNote('note-a.md', 'version one');
    const embedCallsAfterFirst = embeddingClient.calls.length;

    await index.indexNote('note-a.md', 'version two entirely different');

    expect(embeddingClient.calls.length).toBeGreaterThan(embedCallsAfterFirst);
    const results = await index.search('version two entirely different');
    expect(results[0]?.path).toBe('note-a.md');
  });

  it('should expose the count of indexed entries', async () => {
    expect(index.size()).toBe(0);
    await index.indexNote('note-a.md', 'content a');
    await index.indexNote('note-b.md', 'content b');
    expect(index.size()).toBe(2);
  });

  it('should rank the query against every indexed note even on repeated searches', async () => {
    await index.indexNote('note-a.md', 'quantum physics');
    await index.search('physics');

    // Second search must embed the query again and still return results
    const second = await index.search('physics');
    expect(second).toHaveLength(1);
  });

  it('should drop an entry when remove() is called', async () => {
    await index.indexNote('note-a.md', 'content a');
    await index.indexNote('note-b.md', 'content b');

    index.remove('note-a.md');

    expect(index.size()).toBe(1);
    const results = await index.search('content a');
    expect(results.map((r) => r.path)).not.toContain('note-a.md');
    expect(results.map((r) => r.path)).toContain('note-b.md');
  });

  it('should remove a note that was indexed from a file', async () => {
    const file = new TFile();
    file.path = 'note-a.md';
    file.vault.read = vi.fn().mockResolvedValue('sound design content');
    await index.indexNoteFromFile(file);
    expect(index.size()).toBe(1);

    index.remove(file.path);

    expect(index.size()).toBe(0);
  });

  it('indexNoteFromFile should read the file from the vault and index it', async () => {
    const file = new TFile();
    file.path = 'notes/field-recording.md';
    const readMock = vi.fn().mockResolvedValue('field recording techniques');
    file.vault.read = readMock;

    await index.indexNoteFromFile(file);

    expect(readMock).toHaveBeenCalledTimes(1);
    expect(index.size()).toBe(1);
    const results = await index.search('field recording');
    expect(results[0]?.path).toBe('notes/field-recording.md');
  });
});
