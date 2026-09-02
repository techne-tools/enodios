import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import * as obsidianModule from 'obsidian';

import type { Plugin } from '../Plugin.ts';

import { OllamaEmbeddingClient } from './OllamaEmbeddingClient.ts';

// OllamaEmbeddingClient calls `requestUrl`, Obsidian's HTTP helper (mocked in
// src/__tests__/__mocks__/obsidian.ts). `vi.spyOn` on the module export makes
// the source-side `import { requestUrl }` binding hit the spy via Vite's ESM
// live bindings, so tests can drive per-test responses and assert params.
describe('OllamaEmbeddingClient', () => {
  let client: OllamaEmbeddingClient;
  let requestUrlSpy: MockInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    requestUrlSpy = vi.spyOn(obsidianModule, 'requestUrl').mockResolvedValue({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: { embedding: [0.5, 0.25, 0.125] },
      text: ""
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePlugin(overrides: Record<string, unknown> = {}): Plugin {
    return {
      settings: {
        ollamaEmbeddingModel: 'nomic-embed-text',
        ...overrides
      }
    } as unknown as Plugin;
  }

  it('should POST to the Ollama embeddings endpoint and return the vector', async () => {
    client = new OllamaEmbeddingClient(makePlugin());

    const vectors = await client.embed(['field recording notes']);

    expect(vectors).toEqual([[0.5, 0.25, 0.125]]);
    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    expect(params).toMatchObject({ url: 'http://localhost:11434/api/embeddings' });
    if (typeof params === 'object') {
      expect(params.method).toBe('POST');
      const body = JSON.parse(String(params.body));
      expect(body).toMatchObject({
        model: 'nomic-embed-text',
        prompt: 'field recording notes'
      });
    }
  });

  it('should embed multiple texts with one request per text', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    requestUrlSpy.mockResolvedValue({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: { embedding: [1, 0] },
      text: ""
    });

    const vectors = await client.embed(['alpha', 'beta', 'gamma']);

    expect(vectors).toHaveLength(3);
    expect(requestUrlSpy).toHaveBeenCalledTimes(3);
  });

  it('should use the configured model from settings', async () => {
    client = new OllamaEmbeddingClient(
      makePlugin({ ollamaEmbeddingModel: 'all-minilm' })
    );

    await client.embed(['note']);

    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    const body = JSON.parse(
      String(params && typeof params === 'object' ? params.body : '')
    );
    expect(body.model).toBe('all-minilm');
  });

  it('should throw on a non-OK response', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    requestUrlSpy.mockResolvedValueOnce({
      status: 500,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: {},
      text: ""
    });

    await expect(client.embed(['note'])).rejects.toThrow(
      'Ollama embedding API error 500'
    );
  });

  it('isReady should be true when the Ollama API is reachable', async () => {
    client = new OllamaEmbeddingClient(makePlugin());

    await expect(client.isReady()).resolves.toBe(true);
    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    expect(params).toMatchObject({ url: 'http://localhost:11434/api/tags' });
  });

  it('isReady should be false when the Ollama API is unreachable', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    requestUrlSpy.mockRejectedValue(new Error('connection refused'));

    await expect(client.isReady()).resolves.toBe(false);
  });
});
