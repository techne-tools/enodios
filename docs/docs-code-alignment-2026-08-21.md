# Docs–Code Alignment Audit — Enodios (obsidian-hermes)

**Audited:** 2026-08-21 · **Repo:** prismatic7/enodios · **Version checked:** 0.9.0
**Method:** cross-checked README, CHANGELOG, DEVELOPERS, TROUBLESHOOTING, TODO, project skill, source docstrings and git history (incl. full test run: 224/224 pass).

## Status summary

| Area | Verdict |
|---|---|
| Version metadata (manifest/package/versions/CHANGELOG) | Aligned |
| 0.9.0 release notes (lint, types, 224 tests) | Verified — tests actually pass |
| Security posture in code (vault containment, sanitized env, MCP validation, safeStorage, rate limits) | Aligned |
| Export feature claims | **MISALIGNED — feature deleted, docs still advertise it** |
| Terminal allowlist documentation | **MISALIGNED — docs list 14 commands, code allows 6** |
| API-mode approval flow docstring | **MISALIGNED — code is stricter than docstring claims** |
| Secrets storage docs | **MISALIGNED — code is more secure than docs claim** |
| "Semantic Vault RAG" label | **MISALIGNED — currently keyword search** |
| Path drift (`hermes/` vs `enodios/`) | **MISALIGNED — internal inconsistency** |
| `resolveAllPermissions` changelog entry | **MISALIGNED — behavior regressed or entry is wrong** |
| DEVELOPERS.md / TODO.md / project skill / RELEASES.md | **STALE — pre-rebrand (Hermes → Enodios)** |

---

## 1. Conversation export: claimed but deleted (user-facing)

- **Claimed:** README "Export conversations as HTML, JSON, or Markdown"; VaultManager docstring "Export to multiple formats (HTML, JSON, Markdown, PDF data URI)"; TROUBLESHOOTING "Export fails with 'Failed to export conversation'"; DEVELOPERS "Export formats: HTML… JSON… PDF (via printable blob URL)".
- **Actual:** `exportToHtml`, `exportToJson`, `exportToMarkdown`, `exportToPdfDataUri` were deleted in commit `3ffbdad` (2026-06-10, 0.4.1-beta1 hotfix) and never restored. No export code or export UI exists anywhere in `src/`.
- **Fix status:** export claims scrubbed from README, VaultManager, TROUBLESHOOTING, DEVELOPERS (2026-08-21). Decision needed: restore the feature (re-add export methods + UI) or permanently drop it.

## 2. Terminal allowlist: docs list 14, code allows 6

- **Claimed:** TROUBLESHOOTING + DEVELOPERS list `cat, cp, curl, echo, find, git, grep, ls, mkdir, mv, rm, touch, wget`.
- **Actual:** `ALLOWED_SHELL_COMMANDS` in `AcpClient.ts` is `cat, echo, grep, ls, mkdir, touch`. The code's own comment says `git/curl/wget/find/rm/cp/mv` are deliberately excluded (destructive or exfiltration-capable).
- **Fix status:** docs corrected to the 6-command allowlist (2026-08-21).

## 3. API-mode approval flow: docstring says it doesn't exist, code implements it

- **Claimed:** HermesApiClient header: "there is NO inline diff approval flow in API mode — the agent writes directly via its native tools."
- **Actual:** Since 0.4.2, API mode captures a pre-turn vault snapshot, diffs after the turn, routes every change through FileChangeManager with revert-on-reject (`processVaultChanges` / `revertChange`). The docstring describes a security hole that was closed.
- **Action:** update the class header docstring; delete the comparison table row or fix the "Direct write (no approval)" claim in AcpClient's comparison table too.

## 4. Secrets storage: docs say plaintext, code uses OS keychain

- **Claimed:** DEVELOPERS "localStorage is NOT encrypted. Secrets are stored in plaintext…"
- **Actual:** SecretsManager encrypts with Electron `safeStorage` (Keychain/DPAPI/libsecret), `v1:`-prefixed, with a warned plaintext fallback only when safeStorage is unavailable, plus transparent migration of legacy plaintext.
- **Action:** update DEVELOPERS SecretsManager section to describe encryption + fallback.

## 5. "Semantic Vault RAG" is keyword search

- **Claimed:** `/search` described as "Semantic Vault RAG"; TODO claims "Semantic Vault RAG via /search command" completed.
- **Actual:** `SlashCommands.ts` `/search` is substring term-scoring over `vault.cachedRead()` content (Omnisearch optional). No embeddings, no vectors.
- **Action:** semantic RAG planned — see `docs/plans/2026-08-21-semantic-rag.md`. Until then, relabel the command description to avoid the semantic claim.

## 6. Path drift: `hermes/` vs `enodios/`

- Conversations and audit log default to `enodios/` (`chatSaveFolder = 'enodios'`); README/TROUBLESHOOTING/DEVELOPERS still reference `hermes/audit-log.md` and `hermes/2026-05/`; TemplateManager hardcodes `hermes/templates`.
- **Action:** pick one root (recommend `enodios/`), update TemplateManager and all doc references. Note: existing user vaults with `hermes/` folders need a migration note.
- **Fix status:** RESOLVED 2026-08-21 — everything now uses `enodios/` (TemplateManager, tests, CHANGELOG, TODO, project skill, DEVELOPERS). Existing user vaults with `hermes/` folders should migrate: move `hermes/` contents to `enodios/` (conversations, audit log, templates).

## 7. `resolveAllPermissions` changelog entry is wrong or regressed

- **Claimed (CHANGELOG 0.3.0):** "Approve All now only auto-approves permissions with exactly ONE `allow_*` option."
- **Actual:** `resolveAllPermissions()` resolves every pending permission with `allowOptions[0] ?? options[0]` — blanket approval regardless of option count.
- **Action:** decide intended behavior. Either restore the single-option guard (and the `autoApproveSingleOptionPermissions` setting becomes the only auto-approve path) or fix the changelog.

## 8. Pre-rebrand stale docs

- DEVELOPERS.md: references `src/Views/HermesChatView.tsx` (renamed in 0.7.0), clone path `prismatic7/obsidian-hermes` / folder `hermes` (repo is now `prismatic7/enodios`).
- TODO.md: "Current Version: 0.5.0"; missing 0.6–0.9 work.
- `.agent/skills/project/SKILL.md`: manifest id `hermes`, view name, install folder all pre-rebrand.
- `docs/RELEASES.md`: header says "Obsidian Hermes plugin"; content ends at 0.4.1-beta1.
- `src/Views/release.yml`: stale duplicate of the release workflow (no lint/test), divergent from `.github/workflows/release.yml`. Delete it.

## 9. Docs understate security (good direction, still worth fixing)

- DEVELOPERS: "Known Limitation: Symlink traversal is not checked." `isPathSafe` now resolves realpaths and rejects vault escapes. Update the limitation note.

---

## Open decisions (need owner input)

1. **Export feature** — RESOLVED 2026-08-21: permanently dropped (owner decision). Docs scrubbed; the feature will not be restored.
2. **`resolveAllPermissions`:** restore single-option guard, or accept blanket approve-all and fix the changelog?
3. **Folder root:** migrate everything to `enodios/` (incl. TemplateManager `hermes/templates`)? — **RESOLVED 2026-08-21:** migrated (commit `ffea435`).
4. **Semantic RAG embedding backend:** see plan — Phase 1 Hermes `/v1/embeddings`, Phase 2 local Ollama/WASM, or both?

## Fixes applied 2026-08-21

- [x] Scrubbed export claims: README, `src/VaultManager.ts` docstring, TROUBLESHOOTING, DEVELOPERS.
- [x] Corrected shell command allowlist (14 → 6 commands + per-command argument allowlists): TROUBLESHOOTING, DEVELOPERS.
- [x] Fixed audit-log path drift: README/TROUBLESHOOTING/DEVELOPERS now reference `enodios/audit-log.md`.
- [x] Fixed `PluginSettingsTab.ts:437` fallback `'hermes'` → `'enodios'` (Open Audit Log button looked in the wrong folder when Save Folder was empty; `AuditLog.ts` writes to `enodios/`).
- [x] Migrated TemplateManager `hermes/templates` → `enodios/templates` (code + tests) and updated all remaining `hermes/` path references in CHANGELOG, TODO, project skill, DEVELOPERS.
- [x] Wrote semantic RAG implementation plan: `docs/plans/2026-08-21-semantic-rag.md` (Task 0 relabels the current keyword `/search` until semantic search lands).
- [ ] NOT DONE (needs owner decision): `resolveAllPermissions` behavior; pre-rebrand doc refresh (TODO.md version, RELEASES.md); `src/Views/release.yml` removal; HermesApiClient/AcpClient header docstrings (API approval flow). DEVELOPERS.md symlink-limitation note and pre-rebrand references — updated 2026-08-21.
