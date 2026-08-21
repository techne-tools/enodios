import type { Plugin } from '../Plugin.ts';
import type { SecretsManager } from '../SecretsManager.ts';

/**
 * Minimal interface implemented by every embedding backend.
 * Both the Hermes `/v1/embeddings` client and the Ollama fallback
 * implement this so the semantic index is provider-agnostic.
 */
export interface IEmbeddingClient {
  /**
   * Embed one or more texts, returning one vector per input text.
   * Vectors from a given provider must be comparable with each other
   * (same dimensionality), so the index can rank them with cosine
   * similarity.
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Whether this provider is currently usable (API key configured in API
   * mode, Ollama reachable, etc.). The index exposes this to slash
   * commands so they can surface a not-ready message instead of crashing.
   */
  isReady(): Promise<boolean>;
}

/**
 * Client for the Hermes `/v1/embeddings` endpoint (OpenAI-compatible).
 *
 * ARCHITECTURAL ROLE:
 * In API connection mode the plugin already talks to
 * `${baseUrl}/v1/chat/completions` (see HermesApiClient); this client is
 * the sibling embedding endpoint on the same server, authenticated with
 * the same API key from SecretsManager.
 *
 * NOTE ON `fetch`: this runs inside Obsidian's sandbox, which provides a
 * global `fetch` at runtime. Tests mock the global `fetch`.
 */
export class EmbeddingClient implements IEmbeddingClient {
  private readonly plugin: Plugin;
  private readonly secrets: SecretsManager;

  constructor(plugin: Plugin, secrets: SecretsManager) {
    this.plugin = plugin;
    this.secrets = secrets;
  }

  public async embed(texts: string[]): Promise<number[][]> {
    const apiKey = await this.secrets.get('apiKey');
    if (!apiKey) {
      throw new Error('API key is not configured for embeddings.');
    }
    const url = `${this.plugin.settings.hermesApiUrl.replace(/\/$/, '')}/v1/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: texts,
        model: this.plugin.settings.hermesAgentName
      })
    });
    if (!response.ok) {
      throw new Error(`Embedding API error ${response.status}`);
    }
    const data = (await response.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }

  /**
   * The Hermes endpoint is usable only in API connection mode with an API
   * key configured.
   */
  public async isReady(): Promise<boolean> {
    if (this.plugin.settings.connectionMode !== 'api') {
      return false;
    }
    const apiKey = await this.secrets.get('apiKey');
    return apiKey !== '';
  }
}
