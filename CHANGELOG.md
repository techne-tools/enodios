# Changelog

All notable changes to the Obsidian Hermes plugin.

## [0.3.0] - 2026-05-25

### Security (Critical)
- **Fixed `writeTextFile` bypassing session tool restrictions** — `checkToolAllowed()` is now called BEFORE queuing changes in `FileChangeManager`. Previously, disabling "Write Files" in session settings only queued changes for approval rather than blocking them entirely.
- **Fixed `resolveAllPermissions()` blind trust escalation** — "Approve All" now only auto-approves permissions with exactly ONE `allow_*` option. Multi-option permissions require explicit per-permission review.
- **Fixed `sanitizeShellCommand()` path-based command injection** — Removed all shells and script interpreters (`bash`, `sh`, `zsh`, `fish`, `node`, `python`, `npm`, `pnpm`, `npx`, `yarn`, `cmd.exe`, `powershell.exe`, `pwsh`) from the terminal allowlist. Added argument pattern validation to block pipes, redirects, command substitution, `-e`, `-c`, `--eval`, etc.
- **Strengthened `isPathSafe()` across all modules** — Now rejects absolute paths (`/etc/passwd`), null bytes, control characters, and Windows drive-letter paths (`C:\Windows\...`). Applied to `AcpClient.ts`, `FileChangeManager.ts`, and `VaultManager.ts`.
- **Fixed `AuditLog` silent entry loss** — Entries are no longer cleared from the queue before a successful write. Added 3-retry with exponential backoff (500ms → 1000ms → 2000ms). Shows user-visible `Notice` and logs to `console.error()` on permanent failure.
- **Added MCP security mitigations** — MCP servers are now gated behind an explicit opt-in toggle (`mcpServersEnabled`, default `false`). Settings UI shows scary warnings. Audit log records MCP activation/blocked states.

### Bug Fixes
- **Fixed stale diff snapshots after approval** — `FileChangeManager.approveChange()` now calls `refreshPendingDiffsForPath()` to re-compute diffs for remaining pending changes against the newly-written file content.
- **Fixed tool name extraction from ACP notifications** — `parseUpdate()` now checks 5 possible locations for the tool name: `name`, `title`, `toolCall.name`, `tool.name`, `toolName`. Previously only checked `title`, causing "unknown-tool" display.
- **Fixed `HermesApiClient` lacking tool restrictions** — API mode now injects the same "System Instruction: You are ONLY permitted to use..." text that ACP mode does. Also applies persona default tool restrictions when no explicit session override is set.
- **Fixed `window.*` timer references** — Replaced all `window.setTimeout`/`window.clearTimeout` with global equivalents for jsdom test compatibility across 6 files.
- **Fixed `FileChangeManager` test mocks** — Added `workspace` mock to prevent `window is not defined` errors in Vitest.
- **Added missing `prismjs` dependency** — Required for code block syntax highlighting in chat view.
- **Fixed TypeScript build errors** — `.replace()` callback signature and missing dependency issues resolved.

### UX Improvements
- **Enhanced permission UI transparency** — `PendingPermissionsPanel` now displays the **tool name** and **permission type** (e.g., "readTextFile is requesting permission to read_file") instead of the generic "A tool is requesting permission to run".
- **Added scary MCP settings UI** — Toggle labeled "⚠️ Enable External Tool Servers (MCP)" with explicit warning text about bypassing file-approval checks.

### Infrastructure
- All 79 tests passing (5 test suites, ~440ms).
- Build produces `main.js` (1.1M), `styles.css` (30k), `manifest.json`.

## [0.3.0-beta.1] - 2026-05-20

### Bug Fixes
- Fixed SSE buffer not being processed when stream ends — empty assistant responses now populate correctly (`HermesApiClient.ts`)
- Fixed status bar overlapping chat input — container height now accounts for `--status-bar-height`
- Fixed duplicate chat bubbles during typing — empty assistant placeholder is hidden while `TypingIndicator` is active
- Fixed conversation save failures with `by-date` organization mode — `ensureFolderExists()` now creates date subfolders recursively (`VaultManager.ts`)
- Added diagnostic logging to `saveConversation` and `updateConversation` to surface errors in DevTools

### UX Improvements
- Added `getIcon()` to `HermesChatView` so tab bar shows `message-square` icon matching the ribbon
- Improved Previous Conversations dropdown — text wraps, better delineation, limited to 5 most recent
- Added **Export as Markdown** to the export dropdown (`VaultManager.exportToMarkdown()`)
- Removed grey border from inner textarea for cleaner visual appearance
- Added `margin-bottom: 20px` to input container to raise it from the bottom edge

## [0.2.0] - 2026-05-16

### Features
- Dual-mode ACP/API support with secure key storage via `SecretsManager`
- File change approval with inline diff viewer (`FileChangeManager`)
- Permission approval UI in Obsidian (`AcpClient`)
- Session-specific tool execution (per-chat capabilities)
- Terminal access security toggle (default off)
- Code block syntax highlighting in chat view
- Dynamic notification badge on ribbon icon for pending actions
- Conversation branching with message editing
- Semantic Vault RAG via `/search` command
- Canvas integration via `/canvas` command
- Model Context Protocol (MCP) support via settings
- Deep Editor Integration (CodeMirror 6 Ghost Text)
- Bulk actions (Approve All / Reject All) for file changes and permissions
- Support for attaching Images and PDFs as base64 data URIs (5MB limit)
- Copy-to-clipboard buttons for chat messages and code blocks
- Slash command autocomplete with synthetic fallback
- Rate limiting indicators
- Keyboard shortcuts (Cmd+H toggle, Cmd+Shift+H focus)

### Infrastructure
- Added unit tests for `VaultManager` and `SlashCommands` (36 tests)
- Added integration tests for ACP connection flow (48 total tests)
- Full integration test suites for UI, `FileChangeManager`, and streaming hooks
- Hardened `FileChangeManager` against bulk-approval race conditions
- Fixed critical syntax and path normalization bugs for Windows
- Fixed React memory leaks with event listeners in `HermesChatView`
- Fixed auto-scroll race condition using `ResizeObserver`
- Optimized React rendering with `useStreamBuffer` and `requestAnimationFrame`
- Implemented robust frontmatter parsing using Obsidian's `metadataCache`
- Handled deep folder creation securely via `ensureFolderExists`

## [0.1.0] - 2026-05-14

### Initial Release
- Core chat interface with streaming responses
- Markdown rendering for assistant responses
- Chat history persistence to vault folder
- File/note attachment to messages
- Conversation management (new/clear chat)
- Basic settings for API configuration
- Message context/references feature
