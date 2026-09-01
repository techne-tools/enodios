import { TFile } from 'obsidian';

import type { IEmbeddingClient } from './EmbeddingClient.ts';

/**
 * A single indexed note: its path, the content hash it was embedded from,
 * and the embedding vector.
 *
 * NOTE (planned work): index persistence is NOT implemented yet (plan
 * Task 6). The index lives in memory for this pass; the content-hash guard
 * below prevents redundant re-embeds within a session. Persisting the
 * index (serialize `IndexEntry[]` to the plugin data dir, validate hashes
 * against `vault.cachedRead` on load) is planned before the 0.10 release.
 * No persistence means no vectors ever touch disk — nothing leaks to cloud
 * sync this pass.
 */
interface IndexEntry {
  path: string;
  contentHash: string;
  vector: number[];
}

/**
 * In-memory semantic index over vault notes.
 *
 * ARCHITECTURAL ROLE:
 * The RAG retrieval layer for `/search semantic`. Notes are embedded with
 * the configured provider (Hermes `/v1/embeddings` in API mode, or Ollama
 * locally) and ranked against the query embedding with cosine similarity.
 * Results flow into the existing PromptContextItem / note-context pipeline,
 * so both AcpClient and HermesApiClient consume them without changes to the
 * chat streaming path.
 */
export class SemanticSearchIndex {
  private readonly embeddingClient: IEmbeddingClient;
  private entries = new Map<string, IndexEntry>();

  constructor(embeddingClient: IEmbeddingClient) {
    this.embeddingClient = embeddingClient;
  }

  /**
   * Embed and store a note, unless its content hash is unchanged since the
   * last indexing (incremental re-indexing guard).
   */
  public async indexNote(path: string, content: string): Promise<void> {
    const hash = await sha256(content);
    const existing = this.entries.get(path);
    if (existing && existing.contentHash === hash) {
      return;
    }
    const [vector] = await this.embeddingClient.embed([content]);
    if (!vector) {
      throw new Error(`Embedding client returned no vector for ${path}`);
    }
    this.entries.set(path, { path, contentHash: hash, vector });
  }

  /**
   * Read a markdown file from the vault and index it.
   * Used by the vault `modify`/`create` event handlers.
   */
  public async indexNoteFromFile(file: TFile): Promise<void> {
    const content = await file.vault.read(file);
    await this.indexNote(file.path, content);
  }

  /**
   * Drop a note from the index (vault `delete` event).
   */
  public remove(path: string): void {
    this.entries.delete(path);
  }

  /**
   * Rank indexed notes by cosine similarity to the query, descending.
   */
  public async search(
    query: string,
    topK = 5
  ): Promise<{ path: string; score: number }[]> {
    if (this.entries.size === 0) {
      return [];
    }
    const [queryVector] = await this.embeddingClient.embed([query]);
    if (!queryVector) {
      return [];
    }
    return [...this.entries.values()]
      .map((e) => ({ path: e.path, score: cosine(queryVector, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Number of indexed notes.
   */
  public size(): number {
    return this.entries.size;
  }

  /**
   * Whether the configured embedding provider is available (e.g. API key
   * present in API mode, or Ollama reachable in ACP mode).
   */
  public async isReady(): Promise<boolean> {
    return this.embeddingClient.isReady();
  }
}

/**
 * Cosine similarity between two equal-length vectors, in [0, 1] for
 * non-negative embeddings. Returns 0 when either vector is zero-length.
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * SHA-256 hex digest via the WebCrypto API (available in Obsidian's
 * sandbox and in Node >= 20 for tests).
 */
async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
