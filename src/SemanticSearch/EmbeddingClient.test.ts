import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import * as obsidianModule from 'obsidian';
import type { RequestUrlParam } from 'obsidian';

import type { Plugin } from '../Plugin.ts';
import type { SecretsManager } from '../SecretsManager.ts';

import {
  createEmbeddingClient,
  EmbeddingClient,
  EmbeddingProvider
} from './EmbeddingClient.ts';

// The embedding clients call `requestUrl`, Obsidian's HTTP helper (mocked in
// src/__tests__/__mocks__/obsidian.ts). `vi.spyOn` on the module export makes
// the source-side `import { requestUrl }` binding hit the spy via Vite's ESM
// live bindings, so tests can drive per-test responses and assert params.
function okRequestUrlResponse(json: unknown): {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
} {
  return {
    status: 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json,
    text: ""
  };
}

describe('EmbeddingClient (Hermes /v1/embeddings)', () => {
  let client: EmbeddingClient;
  let requestUrlSpy: MockInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    requestUrlSpy = vi
      .spyOn(obsidianModule, 'requestUrl')
      .mockResolvedValue(okRequestUrlResponse({ data: [{ embedding: [1] }] }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePlugin(overrides: Record<string, unknown> = {}): Plugin {
    return {
      settings: {
        connectionMode: 'api',
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
    requestUrlSpy.mockResolvedValueOnce(
      okRequestUrlResponse({
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] }
        ]
      })
    );

    const vectors = await client.embed(['first note', 'second note']);

    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6]
    ]);
  });

  it('should POST to `${baseUrl}/v1/embeddings`', async () => {
    const plugin = makePlugin({ hermesApiUrl: 'http://localhost:8642/' });
    const client = new EmbeddingClient(plugin, makeSecrets('test-key'));

    await client.embed(['note']);

    expect(requestUrlSpy).toHaveBeenCalledTimes(1);
    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    expect(params && typeof params === 'object' ? params.url : '').toBe(
      'http://localhost:8642/v1/embeddings'
    );
    expect(params).toMatchObject({ method: 'POST' });
  });

  it('should send the API key from SecretsManager as a Bearer Authorization header', async () => {
    const secrets = makeSecrets('super-secret-key');
    const client = new EmbeddingClient(makePlugin(), secrets);

    await client.embed(['note']);

    expect(secrets.get).toHaveBeenCalledWith('apiKey');
    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    expect(params && typeof params === 'object' ? params.headers : undefined).toMatchObject({
      Authorization: 'Bearer super-secret-key',
      'Content-Type': 'application/json'
    });
  });

  it('should send the configured agent model in the request body', async () => {
    const client = new EmbeddingClient(
      makePlugin({ hermesAgentName: 'my-agent' }),
      makeSecrets('test-key')
    );

    await client.embed(['note']);

    const [params] = requestUrlSpy.mock.calls[0] ?? [];
    const body = JSON.parse(
      String(params && typeof params === 'object' ? params.body : '')
    );
    expect(body).toMatchObject({
      input: ['note'],
      model: 'my-agent'
    });
  });

  it('should throw when no API key is configured', async () => {
    const client = new EmbeddingClient(makePlugin(), makeSecrets(''));

    await expect(client.embed(['note'])).rejects.toThrow('API key');
    expect(requestUrlSpy).not.toHaveBeenCalled();
  });

  it('should throw on a non-OK response', async () => {
    const client = new EmbeddingClient(makePlugin(), makeSecrets('test-key'));
    requestUrlSpy.mockResolvedValueOnce({
      status: 401,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: {},
      text: ""
    });

    await expect(client.embed(['note'])).rejects.toThrow(
      'Embedding API error 401'
    );
  });

  it('isReady: true only in API mode with an API key', async () => {
    const apiClient = new EmbeddingClient(makePlugin(), makeSecrets('key'));
    await expect(apiClient.isReady()).resolves.toBe(true);

    const acpClient = new EmbeddingClient(
      makePlugin({ connectionMode: 'acp' }),
      makeSecrets('key')
    );
    await expect(acpClient.isReady()).resolves.toBe(false);

    const noKeyClient = new EmbeddingClient(
      makePlugin({ connectionMode: 'api' }),
      makeSecrets('')
    );
    await expect(noKeyClient.isReady()).resolves.toBe(false);
  });
});

describe('createEmbeddingClient (provider factory)', () => {
  let requestUrlSpy: MockInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    requestUrlSpy = vi
      .spyOn(obsidianModule, 'requestUrl')
      .mockResolvedValue(okRequestUrlResponse({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePlugin(overrides: Record<string, unknown> = {}): Plugin {
    return {
      settings: {
        connectionMode: 'api',
        embeddingProvider: 'auto',
        hermesAgentName: 'enodios-agent',
        hermesApiUrl: 'http://localhost:8642',
        ollamaEmbeddingModel: 'nomic-embed-text',
        ...overrides
      }
    } as unknown as Plugin;
  }

  function makeSecrets(apiKey: string): SecretsManager {
    return {
      get: vi.fn().mockResolvedValue(apiKey)
    } as unknown as SecretsManager;
  }

  it('auto: uses Hermes when in API mode with an API key', async () => {
    const client = createEmbeddingClient(
      makePlugin({ connectionMode: 'api' }),
      makeSecrets('key')
    );

    await expect(client.isReady()).resolves.toBe(true);
    // No Ollama probe should have happened
    expect(requestUrlSpy).not.toHaveBeenCalled();
  });

  it('auto: falls back to Ollama when in ACP mode and Ollama is reachable', async () => {
    const client = createEmbeddingClient(
      makePlugin({ connectionMode: 'acp' }),
      makeSecrets('')
    );

    await expect(client.isReady()).resolves.toBe(true);
    expect(requestUrlSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:11434/api/tags' })
    );
  });

  it('auto: not ready when ACP mode and Ollama is unreachable', async () => {
    requestUrlSpy.mockRejectedValue(new Error('connection refused'));
    const client = createEmbeddingClient(
      makePlugin({ connectionMode: 'acp' }),
      makeSecrets('')
    );

    await expect(client.isReady()).resolves.toBe(false);
  });

  it('auto: falls back to Ollama when API mode but no API key', async () => {
    const client = createEmbeddingClient(
      makePlugin({ connectionMode: 'api' }),
      makeSecrets('')
    );

    await expect(client.isReady()).resolves.toBe(true);
    expect(requestUrlSpy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost:11434/api/tags' })
    );
  });

  it('explicit hermes: not ready when API mode is off', async () => {
    const client = createEmbeddingClient(
      makePlugin({ connectionMode: 'acp', embeddingProvider: 'hermes' }),
      makeSecrets('key')
    );

    await expect(client.isReady()).resolves.toBe(false);
  });

  it('explicit ollama: reachability is the only requirement', async () => {
    const client = createEmbeddingClient(
      makePlugin({ embeddingProvider: 'ollama' }),
      makeSecrets('')
    );

    await expect(client.isReady()).resolves.toBe(true);
  });

  it('explicit ollama: not ready when Ollama is down', async () => {
    requestUrlSpy.mockRejectedValue(new Error('refused'));
    const client = createEmbeddingClient(
      makePlugin({ embeddingProvider: 'ollama' }),
      makeSecrets('')
    );

    await expect(client.isReady()).resolves.toBe(false);
  });

  it('EmbeddingProvider is a settings-visible enum of the three modes', () => {
    expect(EmbeddingProvider.Auto).toBe('auto');
    expect(EmbeddingProvider.Hermes).toBe('hermes');
    expect(EmbeddingProvider.Ollama).toBe('ollama');
  });
});
