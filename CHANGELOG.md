# CHANGELOG

## [Unreleased]

### New Features

- **Semantic vault search** — `/search semantic <query>` finds notes by meaning instead of keyword match, using Hermes `/v1/embeddings` (API mode) or a local Ollama model (ACP mode). Embedding provider is configurable in settings (Auto / Hermes API / Ollama); Auto prefers the Hermes server when an API key is configured. The existing keyword `/search` is unchanged and remains the default until the semantic path matures.

## [0.9.0] - 2026-08-20

### New Features

- **Test Type-Checking** — Added `tsconfig.test.json` and a `pnpm test:typecheck` script so test files are statically type-checked against the real Obsidian API, in addition to running at runtime.
- **Expanded Obsidian Test Mock** — The shared `obsidian` mock now covers the full API surface (Vault, Workspace, App, MetadataCache, FileManager, editors, MarkdownRenderer, etc.), plus `mocks/obsidianFiles.ts` helpers for building real-typed file objects in tests.

### Hardening & Code Quality

- **ESLint Safety Rules Re-enabled** — Re-enabled the full set of type-safety lint rules (no-unsafe-\*, no-non-null-assertion, no-floating-promises, no-misused-promises, etc.) and fixed every violation across the codebase (180 → 0 errors). Only genuinely stylistic rules remain off (handled by dprint).
- **Cleaner Type Safety** — Replaced internal-API `@ts-expect-error` casts with explicitly-typed `unknown` casts, removed redundant optional chains/non-null assertions, and tightened promise handling throughout.
- **Final Verification** — Full green pipeline: `pnpm lint`, `tsc` (main + test configs), `pnpm build`, `pnpm format:check`, and all 224 unit tests pass.

## 0.6.2

- docs(changelog): simplify previous version header for parser compatibility
- docs(design): import design pass guidelines, workflows, and cspell settings

## 0.6.1

### New Features

- **Available Web Tools** — Added `web_search` and `web_extract` to the default tool list inside `HermesChatView.tsx` and the **Research Assistant** persona configuration in `PluginSettings.ts`.

### Bug Fixes

- **Hyperlink Contrast Fix** — Styled hyperlinks inside user message bubbles with `var(--text-on-accent)` and an underline, ensuring they are readable and visible against the purple/violet background.
- **Silent Stream Cessation Fix** — Wrapped prompt connection execution and token usage payload processing in a `try/finally` block inside `AcpClient.ts`. This guarantees that stream-completion `stop` updates are always emitted to flush buffers and clean up typing indicator states, resolving silent hangs after failed/rejected tool calls.

## [0.5.0] - 2026-07-08

### New Features

- **Collapsible Settings Tab UI** — Redesigned settings tab with collapsible accordion sections (`PluginSettingsTab.ts`) styled with custom CSS (`main.scss`).
- **Feature Settings Toggles** — Expose settings toggles to enable/disable Citations, PDF Integrations, and Auto-Tagging. Corresponding slash commands (`/cite`, `/pdf`, `/annotations`, `/tags`) are dynamically blocked when disabled.
- **High-Efficiency Approval Shortcuts** — Registered document-level keyboard shortcuts for file change diff reviews (`PendingChangesPanel`):
  - `⌘⇧A` / `Ctrl+Shift+A`: Approve all.
  - `⌘⇧R` / `Ctrl+Shift+R`: Reject all.
  - `⌘Enter` / `Ctrl+Enter`: Approve selected/expanded change.
  - `Esc`: Reject expanded change.
- **Tag Suggestions & Heuristics** — Dynamic keyword and frequency analysis (`TagManager`) and React suggestions modal (`TagSuggestionModal`) to suggest and update YAML frontmatter tags in notes.
- **Conversation Templates** — Support custom templates loading with frontmatter from `hermes/templates/`. Empty chat states render starter cards that load templates directly on click.
- **PDF Annotation & Page Text Parser** — Extracts highlighted text, comments, metadata, and page-specific text using `pdfjsLib` (`PDFAnnotationManager.ts`).
- **ArrowUp to Edit Last Message** — Pressing `ArrowUp` inside the empty chat textarea enters edit mode on the last sent user message and autofocuses.
- **Reasoning Visibility Quick Toggle** — Brain toggle icon in the chat header to quickly hide/show reasoning bubbles, with keyboard shortcut `⌘⌥E`.
- **Sidebar Global Hotkeys** — Focus-aware shortcuts: `⌘⌥C` (New Chat), `⌘⌥L` (Toggle Conversations List), `⌘⌥S` (Toggle Session Settings drawer), `⌘⌥E` (Toggle Reasoning visibility).
- **Enhanced Note Context** — New `contextEnhancer.ts` enriches note context with word count, character count, tags, YAML frontmatter, created/modified timestamps, and backlinks before sending to the agent. Used by both `AcpClient` and `HermesApiClient`.

### Bug Fixes

- **Slash Command Submit Stalling** — Autocomplete dropdown now closes immediately when whitespace is typed after a slash prefix, allowing smooth command execution.
- **Assistant response not rendering after reasoning in ACP mode** — `AcpClient.sendPrompt()` now emits a `stop` update when the ACP `prompt()` promise resolves, matching `HermesApiClient` behavior. This flushes the stream buffer, clears the typing indicator, and reveals the final assistant message after multi-step reasoning/tool turns.

## [0.4.1-beta1] - 2026-06-10

### Bug Fixes

- **Fixed tool execution context lost when `showToolUse` is off** — Tool call messages are now always added to chat history even when the "Show Tool Use" setting is disabled. Previously the entire tool message was silently dropped, leaving the agent's conversation history with no evidence of tool execution. This caused the agent to hallucinate "permission denied" narratives in its reasoning because it couldn't see its own tool activity.
- **Fixed missing permission option labels** — Permission approval bubbles now display all options exactly as Hermes sends them via ACP ("Allow once", "Allow for session", "Allow always", "Deny", "Deny always") instead of hardcoding only two labels. Each option uses `option.name` directly from the protocol, so new or custom permission option names are correctly rendered without code changes.
- **Removed duplicate hardcoded Deny button** — The separate "Deny" button was removed from the permission UI since Hermes already includes a "Deny" option (with `reject_once` or `reject_always` kind) in the options list. All permission options now flow through the same consistent rendering path.

### UX Improvements

- **Compact backgrounded tool indicators** — When "Show Tool Use" is disabled, tool calls now render as subtle single-line indicators (`⚙️ read_file running...` → `✅ read_file completed`) instead of being completely invisible. This preserves execution awareness without visual clutter.

## [0.3.5-beta1] - 2026-06-02

### Bug Fixes

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
