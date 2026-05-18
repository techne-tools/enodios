# Hermes Plugin Development Todo List

**Created:** 14 May 2026
**Phase:** Phase 4 - Polish & Release Prep
**Current Version:** 0.2.0

## Core Features (High Priority)

- [x] Implement message context/references feature
- [x] Add markdown rendering for assistant responses
- [x] Add settings for API configuration
- [x] Implement chat history persistence (vault folder)
- [x] Implement file/note attachment to messages
- [x] Add conversation management (new/clear chat)
- [x] Dual-mode ACP/API support with secure key storage
- [x] File change approval with inline diff viewer
- [x] Reasoning display toggle
- [x] Tool use display toggle
- [x] Terminal access security toggle (default off)

## UX Improvements (Medium Priority)

- [x] Implement streaming responses
- [x] Add typing indicator animation (Unicode braille spinner)
- [x] Implement error handling and retry logic
- [x] Add mobile-responsive styling
- [x] Add keyboard shortcuts (Cmd+H toggle, Cmd+Shift+H focus)
- [x] Implement code block syntax highlighting
- [x] Implement rate limiting indicators
- [x] Add slash command autocomplete with synthetic fallback

## Completed

- [x] Implement message copy/export functionality (via Obsidian native)
- [x] Add agent/model selection (via Hermes tools)
- [x] Implement Hermes /slash commands (use Hermes native tools)
- [x] Create slash commands (use Hermes native tools)
- [x] Implement context/references feature with precise deduplication (15 May 2026)
- [x] Add autocomplete for braces {} and wikilinks [[...]] with filesystem path support (15 May 2026)
- [x] Remove dead code and sample scaffolding (16 May 2026)
- [x] Fix type safety issues (strictNullChecks enabled)
- [x] Bump version to 0.2.0 (16 May 2026)
- [x] Implement permission approval UI in Obsidian (AcpClient) — completed 16 May 2026
- [x] Add unit tests for VaultManager and SlashCommands — completed 16 May 2026 (36 tests)
- [x] Add integration tests for ACP connection flow — completed 16 May 2026 (48 total tests)
- [x] Fix critical syntax and path normalization bugs for Windows (16 May 2026)
- [x] Fix React memory leaks with event listeners in HermesChatView (16 May 2026)
- [x] Implement robust frontmatter parsing using Obsidian's metadataCache (16 May 2026)
- [x] Phase 3: Deep Editor Integration (CodeMirror 6 Ghost Text) (16 May 2026)
- [x] Phase 3: Model Context Protocol (MCP) support via settings (16 May 2026)
- [x] Phase 3: Canvas Integration via `/canvas` command (16 May 2026)
- [x] Phase 3: Terminal Streaming & Control with "Abort" button (16 May 2026)
- [x] Phase 3: Conversation Branching with message editing (16 May 2026)
- [x] Phase 3: Semantic Vault RAG via `/search` command and unit tests (16 May 2026)
- [x] Added bulk actions (Approve All / Reject All) for file changes and permissions (16 May 2026)
- [x] Supported file deletions via `FileChangeManager` (16 May 2026)
- [x] Added Session-specific Tool Execution (per-chat capabilities) (16 May 2026)
- [x] Improved `clearConversation` robustness with optional file deletion (16 May 2026)
- [x] Added code block syntax highlighting in chat view (16 May 2026)
- [x] Added dynamic notification badge to ribbon icon for pending actions (16 May 2026)
- [x] Fixed auto-scroll race condition using `ResizeObserver` (16 May 2026)
- [x] Optimized React rendering with `useStreamBuffer` and `requestAnimationFrame` (16 May 2026)
- [x] Fixed memory leaks in `MarkdownRenderer` child components and ACP terminals (16 May 2026)
- [x] Hardened `FileChangeManager` against bulk-approval race conditions (16 May 2026)
- [x] Handled deep folder creation securely via `ensureFolderExists` (16 May 2026)
- [x] Added support for attaching Images and PDFs as base64 data URIs (16 May 2026)
- [x] Added 5MB safety limit for file attachments (16 May 2026)
- [x] Added copy-to-clipboard buttons for chat messages and code blocks (16 May 2026)
- [x] Added full integration test suites for UI, `FileChangeManager`, and streaming hooks (16 May 2026)

## Implementation Notes

### Markdown Rendering

- Use Obsidian's native markdown renderer
- Support Obsidian Flavored Markdown (OFM)
- Reference: <https://obsidian.md/help/obsidian-flavored-markdown>
- Handle code blocks, callouts, wikilinks, embeds

### Chat History Persistence

- Save conversations to vault folder (e.g., `.hermes/chats/`)
- Format: Markdown files with frontmatter
- Leverage Obsidian's native file management
- Enable export via Obsidian tools/plugins

### Hermes Tools Integration

- Surface available tools from Hermes API
- Enable tool invocation from chat UI
- Display tool results in chat
- Support MCP tools and skills

### Context/References Feature - REIMPLEMENTED (15 May 2026)

**New behavior:**

#### Auto-Add Mode (contextEntireNote = ON)

- When a note is opened/created, existing context is **removed** and replaced with that note
- If text is selected while auto-add is ON, the selection is **added to the context stack**
- Deduplication: precise match by `id` (for notes) or exact text (for selections)
- Same note cannot be added twice (by path)
- Same selection cannot be added twice (by exact text)

#### Manual Mode (contextEntireNote = OFF)

- '@' button adds current note if no text selected
- '@' button adds selection if text is selected
- Deduplication: precise match by `id` (for notes) or exact text (for selections)
- Users can add multiple notes with similar names from different folders (precise path matching)
- Same note/selection cannot be added twice

**Key Changes:**

- **Removed**: Modal-based context selection
- **Added**: Precise deduplication (exact match, not fuzzy)
- **Changed**: Auto-add mode removes all other context when note changes
- **Changed**: Manual mode allows adding current note or selection on demand

**Implementation:**

- `handleContextClick()` in `HermesChatView.tsx` handles both modes
- Auto-scroll effect watches for active file changes when auto-add is enabled

### Autocomplete Feature (15 May 2026)

**New functionality:**

- Type `{` or `[[` to automatically add closing syntax (`}` or `]]`)
- Autocomplete pane opens above input area showing up to 5 most recent notes
- Autocomplete uses filesystem paths with `/` indicating vault root
- Supports both notes and folders
- Type to filter suggestions
- Press Enter/Tab to select, Escape to close

**Implementation:**

- `autocompleteQuery` state tracks user input after opening braces
- `autocompleteSuggestions` state holds file/folder suggestions
- `isAutocompleteOpen` controls pane visibility
- `textareaRef` tracks textarea position for autocomplete placement
- Autocomplete pane positioned absolutely above textarea

### Dual-Mode Support (16 May 2026)

**New functionality:**

- ACP mode: local subprocess via `hermes acp`
- API mode: REST API with SSE streaming
- Connection mode dropdown in settings
- Secure API key storage via Obsidian localStorage
- Test connection buttons for each mode

**Implementation:**

- `ChatClient` interface shared by `AcpClient` and `HermesApiClient`
- `Plugin.getChatClient()` routes to active client
- `SecretsManager` handles secure credential storage

### File Change Approval (16 May 2026)

**New functionality:**

- Intercept `writeTextFile` ACP calls
- Queue changes for user approval
- Inline diff viewer with line-by-line comparison
- Approve / Reject buttons per change
- Clear resolved changes

**Implementation:**

- `FileChangeManager` tracks pending changes
- `PendingChangesPanel` React component in chat view
- `computeDiffLines()` simple line-based diff algorithm

### Security (16 May 2026)

**New functionality:**

- Terminal access disabled by default
- Warning in settings about terminal bypassing diff approval
- All terminal ACP handlers check `allowTerminal` setting

## Next Steps / Phase 4
- [x] Write user documentation, README, and Troubleshooting guides (16 May 2026)
- [x] Setup GitHub Actions release workflow
- [x] Security audit + 7 critical fixes (17 May 2026)
- [x] Top 3 features implemented: Message-Level UUIDs, Persona Templates, Test Suite Fix (17 May 2026)
- [x] All 9 Phase 4 features implemented (17 May 2026) — see Feature Recommendations below
- [x] Build passes, 65/65 tests passing (17 May 2026)
- [ ] Private beta testing (1 week) - note bugs and pinch points in daily workflow
- [ ] Prepare for Beta Release (v0.3.0) - Make repo public and publish to GitHub Releases

## Feature Recommendations (Post-Audit, 17 May 2026)

### 🔴 Critical — Before Public Release

- [x] **Persistent Action Audit Log** — Record every tool invocation, file change, permission grant, and terminal command with timestamps. Essential for trust and debugging. ✅ Implemented 17 May 2026 — `AuditLog.ts` with batched writes to `hermes/audit-log.md`, integrated into AcpClient and FileChangeManager.
- [x] **Conversation-Level System Prompt Templates** — Add `/persona` slash command and settings for saved prompt templates (coding assistant, writing coach, etc.). ✅ Implemented 17 May 2026 — `personaTemplates` in PluginSettings, `/persona` slash command in SlashCommands.ts.
- [x] **Fix Broken Test Suite** — `SlashCommands.test.ts` fails due to missing `obsidian` mock export. `AcpClient.test.ts` has outdated `onPermissionRequest` method name. Fix mocks and update tests. ✅ Fixed 17 May 2026 — All 65 tests passing (4 test files).

### 🟠 High Impact — Significant UX Improvement

- [x] **Message-Level UUIDs** — Replace `timestamp` keys with proper `id: string` (crypto.randomUUID()). Prevents React key collisions and lost messages. ✅ Implemented 17 May 2026 — `generateMessageId()` in `src/utils/uuid.ts`, used throughout `HermesChatView.tsx` and `VaultManager.ts`.
- [x] **Conversation Search & Filtering** — Add `Cmd+F`-style search bar to filter messages in real-time with jump-to-match navigation. ✅ Implemented 17 May 2026 — Search bar with match counter, ↑/↓ navigation, `Cmd+F` shortcut, flash animation on jump.
- [x] **Partial File Change Approval** — Upgrade diff viewer to support line-level approve/reject (like GitHub split diff with checkboxes). ✅ Implemented 17 May 2026 — Checkboxes on added/removed lines, "Approve Selected" vs "Approve All", partial content computed from selected lines.
- [x] **Auto-Reconnection with Exponential Backoff** — Add automatic reconnection for ACP/API with backoff (max 30s) and visual "reconnecting..." state. ✅ Implemented 17 May 2026 — Exponential backoff (1s→30s cap), max 5 attempts, `getConnectionState()` for UI, audit log integration.

### 🟡 Medium Impact — Nice to Have

- [x] **Smart Context: Block-Level References** — Parse selections to detect `[[Note#Heading]]`, code blocks, list ranges. Embed just that block, not the whole note. ✅ Implemented 17 May 2026 — `blockReferences.ts` with heading/code-block/list/block-id parsing, block ref resolution in AcpClient and HermesApiClient.
- [x] **Export Conversations (PDF/HTML/JSON)** — Add export options beyond markdown: HTML (self-contained), JSON (programmatic), PDF. ✅ Implemented 17 May 2026 — Export dropdown in chat header with HTML and JSON download, `exportToHtml()`, `exportToJson()`, `exportToPdfDataUri()` in VaultManager.
- [x] **Token Usage Dashboard** — Display input/output tokens and estimated cost in chat footer. Parsed from `usage_update` ACP event. ✅ Implemented 17 May 2026 — `TokenUsageFooter` component with input/output/total tokens and estimated cost, listens to `hermes-usage-update` window events.
- [x] **Command Palette Integration** — Register quick actions: "Ask Hermes about selection", "Summarize current note", "Generate tags". ✅ Implemented 17 May 2026 — Three new commands in Plugin.ts: `hermes-ask-selection`, `hermes-summarize-note`, `hermes-generate-tags`.

### 🟢 Polish & Differentiation

- [x] **Typing Sound / Haptic Feedback (Optional)** — Subtle audio cues or haptic feedback during agent generation. Optional setting. ✅ Implemented 17 May 2026 — `enableTypingSound` and `enableHapticFeedback` settings, Web Audio API click sounds, `navigator.vibrate()` haptic, throttled to ~20/sec.
- [x] **Conversation Folders / Organization** — Auto-organize by date (`hermes/2026-05/`) or project tag. Manual folders via dropdown. ✅ Implemented 17 May 2026 — `conversationOrganization` setting (`flat`/`by-date`/`by-project`), `generateFilePath()` updated for date-based subfolders.
- [x] **Inline Suggestion Alternatives (Ghost Text v2)** — Show `⌥→` to cycle through 3 completion alternatives, like GitHub Copilot. ✅ Implemented 17 May 2026 — `GhostTextState` with alternatives array, `Alt+ArrowRight` keymap for cycling, alternatives indicator in widget.
- [x] **First-Time Onboarding Flow** — Dismissible welcome message explaining connection modes, slash commands, @ button, and security warnings. ✅ Implemented 17 May 2026 — `OnboardingPanel` component with welcome message, feature list, security note, dismissible with `hasSeenOnboarding` setting.

## Wishlist / Future Work

- Diff approval for terminal-based file edits (Hermes config dependent, not reliably interceptable at the ACP layer)
