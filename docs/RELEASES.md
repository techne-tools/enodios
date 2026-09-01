# Release Notes

This document explains how to create and manage releases for the Enodios plugin (formerly "Hermes Agent for Obsidian"; repo `prismatic7/obsidian-hermes` → `prismatic7/enodios` after the 0.7.0 rebrand).

## v0.9.0 — 20 August 2026

### New Features

- **Test Type-Checking** — Added `tsconfig.test.json` and a `pnpm test:typecheck` script so test files are statically type-checked against the real Obsidian API, in addition to running at runtime.
- **Expanded Obsidian Test Mock** — The shared `obsidian` mock now covers the full API surface (Vault, Workspace, App, MetadataCache, FileManager, editors, MarkdownRenderer, etc.), plus `mocks/obsidianFiles.ts` helpers for building real-typed file objects in tests.

### Hardening & Code Quality

- **ESLint Safety Rules Re-enabled** — Re-enabled the full set of type-safety lint rules (no-unsafe-\*, no-non-null-assertion, no-floating-promises, no-misused-promises, etc.) and fixed every violation across the codebase (180 → 0 errors). Only genuinely stylistic rules remain off (handled by dprint).
- **Cleaner Type Safety** — Replaced internal-API `@ts-expect-error` casts with explicitly-typed `unknown` casts, removed redundant optional chains/non-null assertions, and tightened promise handling throughout.
- **Final Verification** — Full green pipeline: `pnpm lint`, `tsc` (main + test configs), `pnpm build`, `pnpm format:check`, and all 224 unit tests pass.

## v0.8.1 — 19 August 2026

### UX Improvements

- **Starter cards restyled** — Conversation starter cards now use Lucide icons with center alignment.

## v0.8.0 — 19 August 2026

### Bug Fixes

- **Lost responses after tool calls solved** — Assistant responses are no longer dropped after multi-step tool-use turns.

## v0.7.0 — 18 August 2026

### Rebrand: Hermes Agent for Obsidian → Enodios

- Plugin manifest id changed from `hermes` to **`enodios`**; plugin name is now **Enodios**.
- Chat view renamed from `HermesChatView.tsx` to **`EnodiosChatView.tsx`**.
- Repository moved from `prismatic7/obsidian-hermes` to **`prismatic7/enodios`**.
- Install folder is now `<vault>/.obsidian/plugins/enodios/`.
- Conversation and audit-log folders default to `enodios/`.
- This release also applied a refined visual design pass from Open Design.

> **Note for existing users:** vaults that previously stored conversations under a `hermes/` folder will need the folder migrated to `enodios/` (see the audit report `docs/docs-code-alignment-2026-08-21.md`).

## v0.6.2 — 18 August 2026

- Changelog header simplified for parser compatibility.
- Design-pass guidelines, workflows, and cspell settings imported.

## v0.6.1 — 18 August 2026

### New Features

- **Available Web Tools** — Added `web_search` and `web_extract` to the default tool list inside the chat view and the **Research Assistant** persona configuration in `PluginSettings.ts`.

### Bug Fixes

- **Hyperlink Contrast Fix** — Hyperlinks inside user message bubbles are now styled with `var(--text-on-accent)` and an underline so they are readable against the purple/violet background.
- **Silent Stream Cessation Fix** — Wrapped prompt connection execution and token-usage payload processing in a `try/finally` block inside `AcpClient.ts`, guaranteeing stream-completion `stop` updates are always emitted (flushes buffers, clears typing state) — resolves silent hangs after failed/rejected tool calls.

## v0.6.0 — 3 August 2026

### Refactor

- **Chat view decomposed into components and hooks** — `HermesChatView` split into `AuditLogPanel`, `ChatHeader`, `ChatMessageItem`, `MessageList`, plus `useSlashCommands`/`useAutocomplete` hooks, with new `@testing-library/react` hook tests.
- **dprint formatting** applied project-wide.
- Design specs added under `docs/plans/` (conversation organization, native commands).

## v0.5.2 — 31 July 2026

### Security

- **Strict vault-confinement prompt** — Both clients now inject a system prompt binding the agent to the vault's absolute path (`sec(sandbox)`).

### Features

- **Inline diff restoration** — Workspace active-leaf-change listener restores inline diffs in the editor; new setting to hide the pending-changes card in chat.
- **Native slash commands** — bases file creation, table generate/format, git push, admonition insert.
- **Tag-based by-project conversation organization** with `VaultManager` tag resolution.

### Bug Fixes

- Autocomplete/context-button fixes (file detection, empty-query picker, ghost-text visibility); lint fixes for CI.

## v0.5.1 — 9 July 2026

### Features

- **13 community plugin integrations** — Bases, Canvas, Note Composer, Note Templates, Outline, Slides, and more, plus `src/utils/plugins.ts` helpers.
- `manifest.json`/`versions.json` updated for 0.5.1.

### Bug Fixes

- **ACP `stop` update on prompt resolve** — fixes final-message rendering after multi-step reasoning/tool turns.

## v0.5.0 — 8 July 2026

### New Features

- **Collapsible Settings Tab UI** — accordion sections (`PluginSettingsTab.ts`) styled via `main.scss`.
- **Feature Settings Toggles** — enable/disable Citations, PDF Integrations, Auto-Tagging; `/cite`, `/pdf`, `/annotations`, `/tags` blocked when disabled.
- **High-Efficiency Approval Shortcuts** — `⌘⇧A` approve all, `⌘⇧R` reject all, `⌘Enter` approve selected, `Esc` reject (file-change diff review).
- **Tag Suggestions & Heuristics** — `TagManager` keyword/frequency analysis + `TagSuggestionModal` for frontmatter tags.
- **Conversation Templates** — custom templates with frontmatter from `enodios/templates/`; starter cards load them on click.
- **PDF Annotation & Page Text Parser** — highlights, comments, metadata, page text via `pdfjsLib` (`PDFAnnotationManager.ts`).
- **ArrowUp to Edit Last Message**, **Reasoning Quick Toggle** (`⌘⌥E`), **Sidebar Global Hotkeys** (`⌘⌥C/L/S/E`).
- **Enhanced Note Context** — `contextEnhancer.ts` adds word count, tags, frontmatter, timestamps, backlinks for both clients.

### Bug Fixes

- Slash-command autocomplete stalling on whitespace after slash; assistant response not rendering after ACP reasoning.

## v0.4.2 — (2026)

- API mode vault-snapshot approval flow (pre-turn snapshot → post-turn diff → `FileChangeManager` approval with revert-on-reject).

## v0.4.1-beta1 — 10 June 2026

### Bug Fixes

- **Tool execution context preserved with "Show Tool Use" off** — tool messages are always added to chat history so the agent never hallucinates "permission denied".
- **Permission options show all choices** — "Allow once", "Allow for session", "Allow always", "Deny", "Deny always" rendered from `option.name`; duplicate hardcoded Deny button removed.

### UX Improvements

- **Compact backgrounded tool indicators** — single-line `⚙️ read_file running...` → `✅ read_file completed` indicators when tool display is off.

> **Note:** the standalone conversation export feature (HTML/JSON/PDF) was removed in this release (commit `3ffbdad`) and is permanently dropped.

---

## 🧪 Private Beta Releases

Private beta releases are **manually triggered** via GitHub Actions. They are marked as `prerelease` on GitHub and are intended for a small group of testers.

### How to Create a Private Beta Release

1. Go to **Actions → Private Beta Release → Run workflow**.
2. Fill in the required fields:
   - **Version**: Use semantic versioning with a beta suffix, e.g., `0.10.0-beta.1`.
   - **Minimum Obsidian App Version**: The lowest Obsidian version that can run this plugin. Check `versions.json` for the current value.
   - **Release Notes**: A short markdown description of what's new, changed, or fixed in this beta.
3. Click **Run workflow**.

The workflow will:

- Run lint, tests, and build
- Update `manifest.json` and `versions.json`
- Commit the version bump
- Create a GitHub Release with the `prerelease` flag

### How Beta Testers Install

Beta testers should use the **BRAT plugin**:

1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat) from Obsidian's Community Plugins.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Paste the repository URL: `https://github.com/prismatic7/enodios`
4. Enable Enodios in **Settings → Community Plugins**.

BRAT will automatically check for new beta releases and prompt to update.

---

## 🌙 Nightly Builds

Nightly builds are **fully automated** and run every day at 06:00 UTC (or on demand). They represent the latest state of the `main` branch.

### How to Trigger a Nightly Build

1. Go to **Actions → Nightly Build → Run workflow**.
2. Click **Run workflow**.

The workflow will:

- Run lint, tests, and build
- Create (or overwrite) the `nightly` tag and release

### How Testers Install Nightlies

Same process as beta releases — use BRAT with the repository URL. The `nightly` tag is always the latest bleeding-edge build.

---

## 🚀 Public Release (Future)

When the plugin is ready for the Obsidian Community Plugins directory:

1. Update the version in `manifest.json` to a stable version (no `-beta` suffix).
2. Run the **Private Beta Release** workflow with the stable version.
3. Uncheck the `prerelease` box (or create the release manually).
4. Submit to [Obsidian Community Plugins](https://github.com/obsidianmd/obsidian-releases).

---

## 📋 Version Files

| File | Purpose |
|------|---------|
| `manifest.json` | Current plugin version and metadata. Updated on every release. |
| `versions.json` | Maps plugin versions to minimum Obsidian app versions. Updated on every release. |
| `package.json` | Node.js dependencies and scripts. **Not** used by Obsidian at runtime. |

---

## 🔒 Repository Privacy

This repository is **private** during the beta period. Only invited collaborators can:

- View the code
- Open issues and pull requests
- Download releases

When ready for public release, the repository will be made public and the plugin submitted to the Obsidian Community Plugins directory.
