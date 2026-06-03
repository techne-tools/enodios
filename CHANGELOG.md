# Changelog

All notable changes to the Obsidian Hermes plugin.

## [0.4.0-beta] - 2026-06-03

### Security (Major Hardening)
This release includes a comprehensive security audit and hardening pass across the entire plugin. All users on previous beta versions are strongly encouraged to upgrade.

- **Fixed command injection bypass** — `sanitizeShellArguments()` now rejects all shells and script interpreters (`bash`, `sh`, `zsh`, `fish`, `node`, `python`, `npm`, `npx`, etc.) from the terminal allowlist. Added `DANGEROUS_ARG_PATTERNS` to block pipes (`|`), redirects (`>`, `<`), command substitution (`$()`, backticks), and option injection (`-e`, `-c`, `--eval`).
- **Fixed path traversal bypass** — `isPathSafe()` now rejects absolute paths (`/etc/passwd`), null bytes, control characters, and Windows drive-letter paths (`C:\Windows\...`). Applied consistently across `AcpClient.ts`, `FileChangeManager.ts`, and `VaultManager.ts`.
- **Fixed plaintext secret exposure in debug logs** — `DebugLogger` now redacts Bearer tokens, API keys, and passwords via `redactSecrets()` before any log output. Pattern-based matching for `Authorization: Bearer`, `api_key`, `password`, and `token` fields.
- **Added MCP server validation** — `validateMcpServerPath()` ensures MCP server executables are absolute paths (no relative paths), rejects temporary directories (`/tmp`, `/var/tmp`, `/dev/shm`), and blocks world-writable executables. Invalid servers are logged to the audit log and skipped.
- **Gated auto-approval behind explicit setting** — `autoApproveSingleOptionPermissions` defaults to `false`. Users must explicitly opt-in to reduce security. The setting is documented in README with a clear warning.
- **Added rate limiting** — Prompts are rate-limited to 1 per second in both `AcpClient.ts` and `HermesApiClient.ts` to prevent accidental or malicious flooding.
- **Fixed API key handling** — `HermesApiClient` now fails fast with a clear error if the API key is missing or empty, rather than sending invalid requests.
- **Fixed audit log exposure** — `AuditLog` no longer silently drops entries. Added 3-retry with exponential backoff (500ms → 1000ms → 2000ms). Shows user-visible `Notice` and logs to `console.error()` on permanent failure.

### Documentation
- **Updated README.md** — Added comprehensive "Security Architecture" section documenting path traversal protection, shell command allowlisting, rate limiting, audit logging, and secret redaction. Fixed inaccurate feature claims: "Semantic Vault RAG" corrected to "Vault Search (Local RAG)" (keyword-based, not semantic/vector), and PDF export noted as planned but not yet in UI.
- **Updated DEVELOPERS.md** — Added security section for contributors covering the threat model, secure coding guidelines, and audit log requirements.
- **Updated TROUBLESHOOTING.md** — Added security error section documenting common permission denied, rate limit, and audit log failure scenarios.
- **Updated TODO.md** — Corrected completed item names to match actual implementation status.

### Architecture
- Added educational comments across 15+ source files explaining security-critical code, React optimization patterns, and ACP protocol handling.
- Removed duplicate `PromptContextItem` interface definitions.
- Fixed silent error swallowing in `AcpClient.ts` and `HermesApiClient.ts`.

### Infrastructure
- All 79 tests passing (5 test suites, ~388ms).
- Build produces `main.js` (1.2M), `styles.css` (34k), `manifest.json`.

## [0.3.5-beta1] - 2026-06-02

### Features
- **Inline File Approvals** — Replaced whole-file approval workflow with an interactive, CodeMirror-based inline diff viewer directly in the Obsidian editor. Users can now approve or reject changes hunk-by-hunk.

### Bug Fixes
- **Fixed `patch` diff visibility** — The native `patch` tool's diffs are now parsed locally and rendered contextually in the Chat view's permission request bubble.
- **Fixed permission bubble layout clipping** — Resolved a CSS flexbox issue where the chat input container would overlap and clip the bottom of the pending permissions panel.
- **Fixed agent tool retry loops** — Injected a hardcoded system instruction into ACP prompt generation that explicitly commands the LLM to halt and ask the user for direction when a tool call fails due to permission rejection or cancellation.
- **Fixed tool name confusion in ACP protocol** — Renamed all tool IDs to native names (`read_file`, `write_file`, `terminal`) across `PluginSettings.ts`, `SlashCommands.ts`, and `HermesChatView.tsx`. Updated system instructions in `AcpClient.ts` and `HermesApiClient.ts` to reference only native tool names, eliminating agent confusion about `fs/write_text_file` vs `write_file`.
- **Fixed empty `allowedTools: []` treated as "allow all"** — Empty arrays now normalize to `null` (deny all) in both `AcpClient.ts` and `HermesApiClient.ts`, preventing unintended tool access when no tools are explicitly enabled.
- **Fixed `checkToolAllowed('write_file')` blocking client methods** — Session tool restrictions now only apply to agent tools, not ACP client methods (`fs/write_text_file`, `fs/read_text_file`). Previously, disabling "Write Files" in session settings incorrectly blocked the client method entirely.
- **Fixed spinners not stopping on tool completion** — Forces `isRunning=false` on `tool_complete` updates regardless of what the backend reports in `toolCall.status`. Also clears `isRunning` on all tool messages in the error handler.
- **Fixed `resolveAllPermissions()` auto-reject** — Removed blanket auto-reject logic so permissions pass through cleanly to the UI for proper user approval.

### UX Improvements
- **Added copy/drag button to reasoning messages** — Reasoning message headers now include the same copy-to-clipboard and drag-to-note buttons as regular chat messages.
- **Replaced tool spinner with braille helix animation** — Running tools now show a 10-step braille helix (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) instead of the previous 4-step geometric spinner.
- **Added `reasoningMessageIdRef` clear in error handler** — Prevents stale reasoning message references when ACP errors occur.

### Infrastructure
- All 79 tests passing (5 test suites, ~388ms).
- Build produces `main.js` (1.1M), `styles.css` (30k), `manifest.json`.

## [0.3.0] - 2026-05-26

### Bug Fixes
- **Fixed `unknown-tool` display** — Enhanced ACP tool name extraction in `parseUpdate()` to check nested `content.tool.name`, `content.name`, and `content.toolCall.name` fields used by some ACP server implementations.

### UX Improvements
- **Collapsible reasoning messages** — Reasoning output now starts collapsed by default. Each reasoning message has an expand/collapse toggle button in the header. Reduces visual clutter while preserving access to the agent's thought process.
- **Fixed reasoning message ordering** — Reasoning messages are now inserted BEFORE the assistant response placeholder, so they appear above the final answer rather than below it.
- **Added proper tool progress spinner** — Replaced the text `↻` character with a CSS-animated `hermes-tool-spinner` element (rotating border animation) for running tools. More visually distinct and professional.

### Infrastructure
- All 79 tests passing (5 test suites, ~440ms).
- Build produces `main.js` (1.1M), `styles.css` (30k), `manifest.json`.

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
