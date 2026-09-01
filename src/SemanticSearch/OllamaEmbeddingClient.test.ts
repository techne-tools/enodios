import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Plugin } from '../Plugin.ts';

import { OllamaEmbeddingClient } from './OllamaEmbeddingClient.ts';

// OllamaEmbeddingClient calls `fetch`, which Obsidian's sandbox provides
// at runtime. In tests we mock the global fetch.
describe('OllamaEmbeddingClient', () => {
  let client: OllamaEmbeddingClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ embedding: [0.5, 0.25, 0.125] })
    });

    const vectors = await client.embed(['field recording notes']);

    expect(vectors).toEqual([[0.5, 0.25, 0.125]]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/api/embeddings');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'nomic-embed-text',
      prompt: 'field recording notes'
    });
  });

  it('should embed multiple texts with one request per text', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ embedding: [1, 0] })
    });

    const vectors = await client.embed(['alpha', 'beta', 'gamma']);

    expect(vectors).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('should use the configured model from settings', async () => {
    client = new OllamaEmbeddingClient(
      makePlugin({ ollamaEmbeddingModel: 'all-minilm' })
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ embedding: [1] })
    });

    await client.embed(['note']);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('all-minilm');
  });

  it('should throw on a non-OK response', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(client.embed(['note'])).rejects.toThrow(
      'Ollama embedding API error 500'
    );
  });

  it('isReady should be true when the Ollama API is reachable', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    fetchMock.mockResolvedValue({ ok: true });

    await expect(client.isReady()).resolves.toBe(true);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/api/tags');
  });

  it('isReady should be false when the Ollama API is unreachable', async () => {
    client = new OllamaEmbeddingClient(makePlugin());
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(client.isReady()).resolves.toBe(false);
  });
});
