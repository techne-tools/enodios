import type { Plugin } from '../Plugin.ts';

import type { IEmbeddingClient } from './EmbeddingClient.ts';

/**
 * Default Ollama embedding model. `nomic-embed-text` is a small
 * local model (768 dims) that is the sensible default for on-device
 * semantic search; users can override it in settings.
 */
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * Local (on-device) embeddings fallback backed by Ollama's HTTP API.
 *
 * ARCHITECTURAL ROLE:
 * Phase 2 of the semantic search plan: provides semantic search for
 * ACP-only users who don't run the Hermes API server, by reusing Ollama
 * running on the user's machine (`http://localhost:11434`). Requires
 * Ollama to be running with an embedding model installed.
 *
 * NOTE ON `fetch`: this runs inside Obsidian's sandbox, which provides a
 * global `fetch` at runtime. Tests mock the global `fetch`.
 */
export class OllamaEmbeddingClient implements IEmbeddingClient {
  private readonly plugin: Plugin;
  private readonly baseUrl: string;

  constructor(plugin: Plugin, baseUrl = 'http://localhost:11434') {
    this.plugin = plugin;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  public async embed(texts: string[]): Promise<number[][]> {
    const model = this.plugin.settings.ollamaEmbeddingModel;
    const vectors: number[][] = [];
    for (const text of texts) {
      // Ollama's API embeds one prompt per request.
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, prompt: text })
      });
      if (!response.ok) {
        throw new Error(`Ollama embedding API error ${response.status}`);
      }
      const data = (await response.json()) as { embedding: number[] };
      vectors.push(data.embedding);
    }
    return vectors;
  }

  /**
   * Reachability probe: `GET /api/tags` succeeds when Ollama is running.
   */
  public async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
