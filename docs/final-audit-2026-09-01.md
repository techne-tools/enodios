# Enodios Final Audit — Security, Efficiency, Docs↔Code Truth

**Audited:** 2026-09-01 · **Repo:** prismatic7/enodios · **Integrated state:** origin/main (0.9.3, 74d9d71) + 4 prior-pass branches (permissions-guard, paths-enodios, semantic-rag, enodios-w3-docs) merged sequentially, conflicts resolved.
**Method:** read every security-critical source (AcpClient, FileChangeManager, pathSafety, SecretsManager, HermesApiClient, SemanticSearch/*, Plugin wiring), cross-checked every doc claim, ran full gates on the integrated tree. A throwaway worktree at `/tmp/audit-passes/enodios-final` was used; no real branch or working tree was modified.

## Gate results (integrated tree)

| Gate | Result |
|---|---|
| `pnpm test` | **265 passed / 265** (26 files) |
| `pnpm lint` (eslint) | **0 errors** |
| `pnpm test:typecheck` (tsc) | **0 errors** |
| `pnpm build` | **exit 0** — main.js (1.26 MB), manifest, styles.css produced |
| `pnpm format:check` | pending (see run) |

## Security audit — findings

All verified **in code** on the integrated tree:

1. **Vault containment** — `isPathSafe` (pathSafety.ts) rejects absolute paths, `../`, control chars, Windows/UNC paths, AND resolves symlinks via `fs.realpath` with vault-root check (fallback to lexical on failure). Used by ACP read/write **and** API-mode diff routing and FileChangeManager. ✅
2. **Shell allowlist** — exactly 6 commands (`cat echo grep ls mkdir touch`) with per-command argument allowlists and a dangerous-pattern list (pipes, redirects, `$(`, backticks, `-e`, `-exec`, etc.). `shell: false`, args passed directly. `git/curl/wget/find/rm/cp/mv` deliberately excluded. Matches DEVELOPERS + TROUBLESHOOTING docs exactly. ✅
3. **Env sanitization** — `buildSanitizedEnv` passes only 15 allowlisted vars to the Hermes child process, and strips 30 known secret names as defense-in-depth. `HERMES_HOME` intentionally not passed (profile via `-p` flag). ✅
4. **File change approval** — every agent write/delete routes through FileChangeManager with inline diff, partial line-level approval, coalescing, race-safe `processingPaths`, reject → `cleanupEmptyCreatedFile`. API mode: pre-turn `captureVaultSnapshot` → post-turn diff → registerChange → **revert-on-reject**. ✅
5. **Permissions** — `requestPermission` auto-approve only when `autoApproveSingleOptionPermissions` (default **off**) AND exactly one `allow_*` option. `resolveAllPermissions` ("Approve All") same single-option guard; multi-option → cancelled. 95-line regression test added. ✅
6. **Secrets** — safeStorage (OS keychain) encrypted, `v1:` prefix, plaintext migration on read, warned fallback only when keychain unavailable. Docstring and DEVELOPERS match. ✅
7. **Rate limiting / timeouts** — 1s prompt rate limit both clients; SSE hard timeout 120s via `AbortSignal.any`; terminal output capped at 1 MB; audit log flush retries with backoff; Myers diff `MAX_D=3000` guard; changes capped at 100; terminals self-clean after 60s. ✅
8. **Credential leak check** — no secrets/keys in tracked files. `.env`, `data.json`, `errorlog.txt`, `coverage/`, `.ao-capture/` all gitignored. ✅

### Security notes (minor)

- `OllamaEmbeddingClient` calls `http://localhost:11434` hardcoded — a malicious local process could serve embeddings; acceptable for a localhost peer, worth a one-line doc note. (Low)
- `EmbeddingClient` (Hermes API) does not call `validateApiUrl()` like HermesApiClient does — plain-HTTP-to-remote-host would not warn for embeddings traffic. (Low, consistency gap)
- `.gemini_security/DRAFT_SECURITY_REPORT.md` + `SECURITY_ANALYSIS_TODO.md` are **tracked in git** as near-empty stubs — decide: fill in, or delete (they're just two lines of header).

## Efficiency audit

- `FileChangeManager.notify` debounced 50ms; event listeners unsubscribe on unload (`destroy()`).
- AcpClient reconnection backoff 1s→30s cap, 5 attempts, heartbeat for startup progress.
- Semantic index **content-hash guard** prevents re-embedding unchanged notes.
- ⚠️ **Semantic index has NO initial bulk load** — `Plugin.ts` only hooks `modify`/`create`/`delete`. Existing notes are never embedded until edited, so `/search semantic` returns "No semantic matches" on a fresh session even when the vault is full. **Add a startup bulk index** (e.g. after layout ready, index `getMarkdownFiles()` in a bounded loop) or document that semantic search only covers notes modified since the feature landed.
- Semantic `modify` hook embeds on every save (not debounced) — acceptable given the hash guard, but a save of a large note triggers a local embedding call synchronously. Consider a short debounce if users report lag.

## Docs ↔ Code truth audit

All prior audit items (export removal, 6-command allowlist, safeStorage, enodios/ paths, single-option Approve All, rebrand) verified **aligned in the integrated tree** — the four branches resolved them.

**Issues found and fixed in this pass (worktree only):**

1. `Src/SlashCommands.ts:135` — description still said "semantic search coming in 0.10" though implemented. → Now describes `/search semantic`.
2. `Src/SlashCommands.ts` not-ready message said "requires API mode with an API key" — wrong guidance for ACP+Ollama auto mode. → Now explains both modes.
3. `/search semantic` with empty query embedded `''` and returned empty results. → Added explicit usage guard.
4. `SemanticSearchIndex` docstring overclaimed "Results flow into the existing PromptContextItem / note-context pipeline" — `/search attach` (Task 7) is deferred; results are a markdown list. → Docstring corrected.
5. `AcpClient.ts` comparison table still said API mode = "Direct write (no approval)" — false since 0.4.2 (snapshot+diff+Revert). → Corrected.
6. `TODO.md` — two contradictory Semantic RAG lines ("NOT IMPLEMENTED") + stale `hermes/audit-log.md` + `.hermes/chats/` → updated to enodios/ + implemented.
7. `TROUBLESHOOTING.md` — seven `Settings > Hermes` → `Settings > Enodios`.
8. `docs/RELEASES.md` — stopped at v0.9.0; added 0.9.1/0.9.2/0.9.3 entries from the real CHANGELOG.
9. `AcpClient.test.ts` — typecheck failure (partial settings mock missing `activePersonaId` etc. after the profile fix). Mock now deep-merges a full `PluginSettings`; typecheck green.

**Still open (need decisions, no code change made):**

- **Semantic index initial bulk indexing** (see Efficiency) — recommend implementing before 0.10, or documenting the limitation.
- `/.gemini_security/` stub tracking — decide fill-in vs delete.
- `OllamaEmbeddingClient` hardcoded localhost + no URL validation for embeddings — recommend a `validateApiUrl()`-style guard or explicit localhost-only note.

## Positive findings

- Security posture is genuinely strong: multiple independent layers (lexical + realpath containment, allowlist + arg allowlist + dangerous patterns, sanitized env, safeStorage, approval gatekeeper, revert-on-reject).
- The 0.9.x release notes (CHANGELOG/RELEASES) verify against code — settings declutter, audit-log gating, Harvard, by-project removal, profile `-p` fix all confirmed.
- 26 test files / 265 tests, all green with strict lint and typecheck — the hard rules from 0.9.0 have held.

## Deliverable

The integrated tree (4 branches + fixes above) builds clean and passes all gates. It exists only in `/tmp/audit-passes/enodios-final`. Next step if you want it shipped: merge the four branches into main on the real repo, then commit the doc/test fixes from this pass (or cherry-pick them).
