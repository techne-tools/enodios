import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Plugin } from '../Plugin.ts';
import type { SecretsManager } from '../SecretsManager.ts';

import { EmbeddingClient } from './EmbeddingClient.ts';

// EmbeddingClient calls `fetch`, which Obsidian's sandbox provides at
// runtime. In tests we mock the global fetch.
describe('EmbeddingClient', () => {
  let client: EmbeddingClient;
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
        hermesAgentName: 'enodios-agent',
        hermesApiUrl: 'http://localhost:8642',
        ...overrides
      }
    } as unknown as Plugin;
  }

  function makeSecrets(apiKey: string): SecretsManager {
    return {
      get: vi.fn().mockResolvedValue(apiKey)
    } as unknown as SecretsManager;
  }

  it('should embed texts and return the vectors from the response', async () => {
    client = new EmbeddingClient(makePlugin(), makeSecrets('test-key'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] }
        ]
      })
    });

    const vectors = await client.embed(['first note', 'second note']);

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ]);
  });

  it('should POST to `${baseUrl}/v1/embeddings`', async () => {
    const plugin = makePlugin({ hermesApiUrl: 'http://localhost:8642/' });
    const client = new EmbeddingClient(plugin, makeSecrets('test-key'));
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ embedding: [1] }] })
    });

    await client.embed(['note']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8642/v1/embeddings');
    expect(init).toMatchObject({
      method: 'POST'
    });
  });

  it('should send the API key from SecretsManager as a Bearer Authorization header', async () => {
    const secrets = makeSecrets('super-secret-key');
    const client = new EmbeddingClient(makePlugin(), secrets);
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ embedding: [1] }] })
    });

    await client.embed(['note']);

    expect(secrets.get).toHaveBeenCalledWith('apiKey');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer super-secret-key',
      'Content-Type': 'application/json'
    });
  });

  it('should send the configured agent model in the request body', async () => {
    const client = new EmbeddingClient(
      makePlugin({ hermesAgentName: 'my-agent' }),
      makeSecrets('test-key')
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ embedding: [1] }] })
    });

    await client.embed(['note']);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      input: ['note'],
      model: 'my-agent'
    });
  });

  it('should throw when no API key is configured', async () => {
    const client = new EmbeddingClient(makePlugin(), makeSecrets(''));

    await expect(client.embed(['note'])).rejects.toThrow('API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should throw on a non-OK response', async () => {
    const client = new EmbeddingClient(makePlugin(), makeSecrets('test-key'));
    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(client.embed(['note'])).rejects.toThrow(
      'Embedding API error 401'
    );
  });
});
