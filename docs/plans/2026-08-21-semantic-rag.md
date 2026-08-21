# Semantic Vault RAG Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the current keyword-only `/search` with a real semantic vault search that returns the most relevant notes (by meaning, not substring match) and attaches them to the conversation context.

**Architecture:** An embedding-backed retrieval layer with two backends — Phase 1 uses Hermes' own `/v1/embeddings` endpoint (already available in API mode; zero new external services), Phase 2 adds a local on-device index for ACP-only users. Embeddings are cached per-file against a content hash so re-indexing is incremental. Results flow through the existing `PromptContextItem`/note-context pipeline so both `AcpClient` and `HermesApiClient` get the same context injection with zero changes to the chat streaming path.

**Tech Stack:** TypeScript, Obsidian Plugin API (`vault`, `metadataCache`, `FileSystemAdapter`), Hermes `/v1/embeddings` (OpenAI-compatible), optional local cosine-similarity implementation, Vitest.

---

## Background (why this plan exists)

The `/search` slash command (`src/SlashCommands.ts` lines 135–199) is documented and described as "Semantic Vault RAG" but is actually keyword scoring: it splits the query into terms and scores notes by `indexOf` substring hits over `vault.cachedRead()` content. It has no embeddings, no vector index, and no meaning-based ranking. Omnisearch (if installed) is used as an optional upstream, but that is still lexical/BM25-style.

This plan lands the semantic capability the label already promises, then relabels the command honestly (see Task 0).

## Key integration points (verified in source)

- Slash dispatch: `src/Views/EnodiosChatView.tsx:1184` calls `parseSlashCommand(fullText)` → `command.execute(plugin, args)` → result rendered as a `system` message. Search commands that attach context therefore must either (a) return markdown (current behaviour) or (b) dispatch a synthetic prompt with context items. This plan keeps (a) for the summary list and adds a `/search attach` subcommand that uses (b) via the existing `chatView.sendPrompt(...)` path used by the command palette commands in `Plugin.ts`.
- Context item plumbing: `PromptContextItem` (`src/AcpClient.ts:248`) and both `sendPrompt` implementations already handle `type: 'note'` items and resolve them through `getEnhancedNoteContext()` (`src/utils/contextEnhancer.ts`). The RAG layer only needs to produce `{ id: 'note-<path>', text: <basename>, type: 'note' }` items.
- Embedding endpoint: Hermes API mode already talks to `${baseUrl}/v1/chat/completions` (`HermesApiClient.ts:327`). The OpenAI-compatible `/v1/embeddings` endpoint is the natural sibling. API key handling reuses `SecretsManager.get('apiKey')`.
- File watching for incremental index: reuse `plugin.app.vault.on('modify'/'create'/'delete')` (the plugin already registers workspace events; a vault event subscription is the same pattern).

---

## Task 0: Relabel the current command (honesty fix — do first)

**Objective:** Stop claiming semantics before the feature exists.

**Files:**
- Modify: `src/SlashCommands.ts:135` (description string)

**Step 1:** Change the description to:
```ts
description: 'Search the vault and append results to context (keyword search; semantic search coming in 0.10)',
```

**Step 2:** Run tests: `pnpm test` — expected: SlashCommands tests still pass.

**Step 3:** Commit.
```bash
git add src/SlashCommands.ts
git commit -m "docs(search): relabel /search as keyword until semantic RAG lands"
```

---

## Task 1: Embedding client (Hermes `/v1/embeddings`)

**Objective:** Create a thin, cached client for the Hermes embeddings endpoint, used in API mode.

**Files:**
- Create: `src/SemanticSearch/EmbeddingClient.ts`
- Create: `src/SemanticSearch/EmbeddingClient.test.ts`
- Modify: `src/Plugin.ts` (instantiate and expose as `plugin.semanticSearch`)

**Step 1: Write failing test** (`src/SemanticSearch/EmbeddingClient.test.ts`)
- `fetch` mock returns `{ data: [{ embedding: [0.1, 0.2] }] }`.
- Assert `embed(query)` returns the vector.
- Assert the endpoint is `${baseUrl}/v1/embeddings`.
- Assert Authorization header uses the API key from `SecretsManager`.

**Step 2:** Run test — expected: FAIL (module doesn't exist).

**Step 3: Implement**

```ts
export class EmbeddingClient {
  constructor(
    private readonly plugin: Plugin,
    private readonly secrets: SecretsManager,
  ) {}

  public async embed(texts: string[]): Promise<number[][]> {
    const apiKey = await this.secrets.get('apiKey');
    if (!apiKey) throw new Error('API key is not configured for embeddings.');
    const url = `${this.plugin.settings.hermesApiUrl.replace(/\/$/, '')}/v1/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.plugin.settings.hermesAgentName,
      }),
    });
    if (!response.ok) throw new Error(`Embedding API error ${response.status}`);
    const data = (await response.json()) as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
}
```

**Step 4:** Wire into `Plugin.ts`:
```ts
this.semanticSearch = new SemanticSearchIndex(this);
```

**Step 5:** Run tests — expected: PASS.

**Step 6:** Commit.
```bash
git add src/SemanticSearch/
git commit -m "feat(search): add Hermes /v1/embeddings client"
```

---

## Task 2: Semantic search index (cache + cosine ranking)

**Objective:** Maintain an in-memory (and later persisted) index of note → embedding, with cosine similarity ranking.

**Files:**
- Create: `src/SemanticSearch/SemanticSearchIndex.ts`
- Create: `src/SemanticSearch/SemanticSearchIndex.test.ts`

**Step 1: Write failing tests**
- `indexNote(path, content)` embeds and stores.
- `search(query, topK)` returns ranked `{ path, score }[]` sorted desc.
- Content hash guard: re-indexing a file with unchanged content is a no-op.

**Step 2:** Run tests — expected: FAIL.

**Step 3: Implement** (core pieces):

```ts
interface IndexEntry { path: string; contentHash: string; vector: number[]; }

export class SemanticSearchIndex {
  private entries = new Map<string, IndexEntry>();

  public async indexNote(path: string, content: string): Promise<void> {
    const hash = await sha256(content);
    const existing = this.entries.get(path);
    if (existing && existing.contentHash === hash) return;
    const [vector] = await this.embeddingClient.embed([content]);
    this.entries.set(path, { path, contentHash: hash, vector });
  }

  public async search(query: string, topK = 5): Promise<{ path: string; score: number }[]> {
    const [queryVector] = await this.embeddingClient.embed([query]);
    return [...this.entries.values()]
      .map((e) => ({ path: e.path, score: cosine(queryVector, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
```

(Use `crypto.subtle.digest` for `sha256`; store content hash so incremental re-indexing skips unchanged files.)

**Step 4:** Run tests — expected: PASS.

**Step 5:** Commit.
```bash
git add src/SemanticSearch/SemanticSearchIndex.ts src/SemanticSearch/SemanticSearchIndex.test.ts
git commit -m "feat(search): in-memory semantic index with cosine ranking"
```

---

## Task 3: Wire vault events for incremental indexing

**Objective:** Keep the index fresh by indexing new/modified notes and dropping deleted ones.

**Files:**
- Modify: `src/Plugin.ts` (register vault events in `onloadImpl`)
- Modify: `src/SemanticSearch/SemanticSearchIndex.ts` (add `remove(path)`)

**Step 1: Implement**
```ts
this.registerEvent(
  this.app.vault.on('modify', (file) => {
    if (file instanceof TFile && file.extension === 'md') {
      void this.semanticSearch.indexNoteFromFile(file);
    }
  }),
);
this.registerEvent(
  this.app.vault.on('delete', (file) => {
    this.semanticSearch.remove(file.path);
  }),
);
```

**Step 2:** Add `indexNoteFromFile` (reads via `vault.read`, calls `indexNote`) and `remove(path)`.

**Step 3:** Add a test that `remove` drops the entry and `indexNoteFromFile` calls `vault.read` once.

**Step 4:** Run tests — expected: PASS.

**Step 5:** Commit.

---

## Task 4: `/search semantic <query>` slash command

**Objective:** Expose the semantic index through the existing slash-command surface, without breaking the keyword path.

**Files:**
- Modify: `src/SlashCommands.ts` (add `semantic` subcommand to the `/search` handler)

**Step 1:** Add subcommand handling:

```ts
if (sub === 'semantic') {
  if (!plugin.semanticSearch.isReady()) {
    return 'Semantic search requires API mode with an API key configured.';
  }
  const results = await plugin.semanticSearch.search(rest, 5);
  if (results.length === 0) {
    return `No semantic matches found for "${rest}". Try /search "${rest}" for keyword results.`;
  }
  // Build context items and either return markdown or (future) attach via sendPrompt
  let list = `### 🧠 Semantic Search Results for "${rest}"\n\n`;
  for (const r of results) {
    list += `* **[[${r.path}]]** (score: ${r.score.toFixed(3)})\n`;
  }
  return list;
}
```

**Step 2:** Add `isReady()` to the index (true when an `EmbeddingClient` is available and API mode is active).

**Step 3:** Write tests: `search semantic` returns formatted list; returns not-ready message when no API key.

**Step 4:** Run tests — expected: PASS.

**Step 5:** Commit.

---

## Task 5: Phase 2 — local (on-device) embeddings fallback

**Objective:** Provide semantic search for ACP-only users who don't run the Hermes API server, using a small local embedding model.

**Design decision (flag for owner):** Two options —
- (a) Ship a small WASM embedding model (e.g. `@xenova/transformers` MiniLM) bundled with the plugin. Pros: fully offline, no server. Cons: ~15–30 MB bundle, slower first index, Obsidian plugin size limits.
- (b) Reuse Ollama on the user's machine (via `http://localhost:11434/api/embeddings`) if running. Pros: tiny plugin, reuses existing infra. Cons: requires Ollama running with a model installed; not guaranteed for other users.

**Recommendation:** Implement (b) with a settings toggle (`Embedding Provider: Auto | Hermes API | Ollama`) and detect at runtime. Defer (a) unless a user needs fully offline embedding.

**Files (Phase 2):**
- Modify: `src/PluginSettings.ts` (add `embeddingProvider` setting)
- Modify: `src/PluginSettingsTab.ts` (add dropdown)
- Create: `src/SemanticSearch/OllamaEmbeddingClient.ts`
- Modify: `src/SemanticSearch/EmbeddingClient.ts` (factory that picks provider)

**Step 1:** Add setting + dropdown (default `auto`).
**Step 2:** Implement `OllamaEmbeddingClient` (`POST http://localhost:11434/api/embeddings` with `{ model, prompt }`, response `{ embedding: number[] }`).
**Step 3:** Factory in `EmbeddingClient` chooses provider; `isReady()` reflects the selected provider's availability.
**Step 4:** Tests: mock fetch for Ollama endpoint; settings switch.
**Step 5:** Commit.

---

## Task 6: Persist the index (optional, recommended before 0.10 release)

**Objective:** Avoid re-embedding the whole vault on every startup.

**Files:**
- Create: `src/SemanticSearch/IndexStore.ts` (JSON cache in `.obsidian/plugins/enodios/semantic-index.json` or vault-side `enodios/.semantic-index.json`)

**Step 1:** Serialize `{ path, contentHash, vector }[]` to JSON on unload and on a debounce after indexing batches.
**Step 2:** Load on startup; validate content hashes against `vault.cachedRead` lazily (only re-embed stale entries).
**Step 3:** Tests: round-trip save/load; corrupt-file fallback to empty index.
**Step 4:** Commit.

---

## Task 7: `/search attach` — inject results as context items

**Objective:** Make semantic hits flow into the agent's context the same way `/canvas` and note-attachment do.

**Files:**
- Modify: `src/SlashCommands.ts`
- Modify (if needed): `src/Views/EnodiosChatView.tsx` (sendPrompt path already supports context items)

**Step 1:** In the `semantic` subcommand, after ranking, build:
```ts
const contextItems = results.map((r) => ({
  id: `note-${r.path}`,
  text: r.path.split('/').pop() ?? r.path,
  type: 'note' as const,
}));
```
**Step 2:** Dispatch a prompt via the same mechanism `Plugin.ts` uses for "Ask Enodios about selection" (`openView` → `chatView.sendPrompt(prompt, contextItems)`). Return `null` from the command so no duplicate system message renders.
**Step 3:** Test: `sendPrompt` called with context items; returns null.
**Step 4:** Commit.

---

## Task 8: Documentation & release notes

**Objective:** Keep docs aligned with reality (this repo's recurring failure mode).

**Files:**
- Modify: `README.md` (add semantic search bullet under "What you can do")
- Modify: `CHANGELOG.md` (0.10.0 entry)
- Modify: `DEVELOPERS.md` (document `src/SemanticSearch/`)
- Modify: `.agent/skills/project/SKILL.md` (add `src/SemanticSearch/` to Key Directories)

**Step 1:** Update README:
```markdown
- **Semantic vault search**: `/search semantic <query>` finds notes by meaning using Hermes embeddings (API mode) or a local Ollama model.
```
**Step 2:** Update CHANGELOG with 0.10.0 features + the Task 0 relabel.
**Step 3:** Commit.

---

## Verification checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm test` — all suites pass (existing 224 + new SemanticSearch suites)
- [ ] `pnpm build` produces `dist/build/main.js`
- [ ] Manual: API mode → `/search semantic "sound design methodology"` returns meaning-based results
- [ ] Manual: keyword fallback still works: `/search sound design`
- [ ] Manual: ACP mode without Ollama → `/search semantic` returns the not-ready message (no crash)
- [ ] Index survives restart (Task 6)
- [ ] Docs updated (README/CHANGELOG/DEVELOPERS/project skill)

## Risks / decisions needed

1. **Provider priority** (Task 5): Hermes API first or Ollama first in `auto`? Recommend: API if `connectionMode === 'api'`, else Ollama, else not-ready message.
2. **Index persistence location** (Task 6): vault-side (visible, syncs, possibly large) vs plugin-data dir (hidden, local only). Recommend vault-side for transparency; exclude from git if the vault is a repo.
3. **Embedding model choice for Ollama**: `nomic-embed-text` is the sensible default; allow override in settings.
4. **Privacy**: vectors are derived from note content. If the user syncs the vault to cloud, the persisted index leaks content similarity structure. Default the index store to plugin-data dir OR document the trade-off prominently. Flag for owner.
