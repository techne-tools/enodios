# Hermes Plugin Development Todo List

**Created:** 14 May 2026
**Phase:** Phase 4 - Polish & Release Prep
**Current Version:** 0.3.0

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
- [x] **Beta Testing Fixes (20 May 2026)**:
  - Fixed SSE buffer not being processed when stream ends — empty assistant responses now populate correctly (`HermesApiClient.ts`)
  - Fixed status bar overlapping chat input — container height now accounts for `--status-bar-height`
  - Fixed duplicate chat bubbles during typing — empty assistant placeholder is hidden while `TypingIndicator` is active
  - Fixed conversation save failures with `by-date` organization mode — `ensureFolderExists()` now creates date subfolders recursively (`VaultManager.ts`)
  - Added diagnostic logging to `saveConversation` and `updateConversation` to surface errors in DevTools
  - Added `getIcon()` to `HermesChatView` so tab bar shows `message-square` icon matching the ribbon
  - Improved Previous Conversations dropdown — text wraps, better delineation, limited to 5 most recent
  - Added **Export as Markdown** to the export dropdown (`VaultManager.exportToMarkdown()`)
  - Removed grey border from inner textarea for cleaner visual appearance
  - Added `margin-bottom: 20px` to input container to raise it from the bottom edge

- [x] **Security Hardening & Bug Fixes (25 May 2026)** — since `f4a27fb`:
  - Fixed `window.*` timer references (`setTimeout`/`clearTimeout`) across 6 files for jsdom test compatibility
  - Fixed `FileChangeManager` test mocks — added `workspace` mock to prevent `window is not defined` errors
  - Added `prismjs` dependency for code block syntax highlighting
  - Fixed TypeScript build errors (`.replace()` callback signature, missing dependency)
  - **MCP Security Mitigations**:
    - Added `mcpServersEnabled` toggle (default `false`) to `PluginSettings.ts`
    - Added scary MCP settings UI with explicit warnings in `PluginSettingsTab.ts`
    - Added conditional MCP server path passing in `AcpClient.ts` (only passes servers when enabled)
    - Added audit logging of MCP activation/blocked states in `AuditLog.ts`
  - **Critical Security Fixes** (adversarial review):
    - Fixed `writeTextFile` bypassing `checkToolAllowed()` — session tool restrictions now enforced BEFORE queuing
    - Fixed `resolveAllPermissions()` blind trust escalation — now only auto-approves single-option permissions
    - Fixed `sanitizeShellCommand()` path-based command injection — removed all shells/interpreters from allowlist
    - Strengthened `isPathSafe()` across all modules — rejects absolute paths, null bytes, Windows drive letters
    - Fixed `AuditLog` silent entry loss — added retry with exponential backoff and user-visible alerts
    - Fixed stale diff snapshots after approval — re-computes diffs against newly-written content
    - Added tool restrictions to `HermesApiClient` — API mode now injects same system instructions as ACP
    - Enhanced permission UI transparency — displays tool name and permission type in approval panel
    - Fixed tool name extraction from ACP notifications — checks `name`, `title`, `toolCall.name`, `tool.name`, `toolName`

- [x] **UI/UX Improvements (26 May 2026)**:
  - Fixed `unknown-tool` display — enhanced ACP tool name extraction to check nested `content.tool`, `content.name`, and `content.toolCall.name` fields
  - Added collapsible reasoning messages — reasoning starts collapsed by default, can be expanded/collapsed via header button
  - Fixed reasoning message ordering — reasoning now appears BEFORE the assistant response (inserted above the streaming placeholder)
  - Added proper CSS spinner animation for running tools — replaced text `↻` with animated `hermes-tool-spinner` element
  - Added `isCollapsed` field to `ChatMessage` interface for reasoning state persistence

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

---

## Cross-Platform Feature Porting Plan (19 May 2026)

### 📚 Features from Zotero Plugin to Port to Obsidian

Based on analysis of both codebases, the following Zotero features could usefully be ported to Obsidian Hermes:

### **Tier 1: High Impact, High Feasibility** ⭐⭐⭐

#### 1. Citation Management System
**Zotero Implementation**: `CitationManager.ts`
- Get configured citation style from Zotero prefs
- Generate formatted citations using CSL engine
- Support for in-text citations and bibliography
- Multiple citation styles support (APA, MLA, Chicago, etc.)

**Obsidian Implementation Plan**:
- Add `CitationManager.ts` module
- Use `citeproc` or similar JavaScript CSL library
- Add `/cite` slash command with style selector
- Support citation insertion with `[@citation-key]` syntax
- Generate bibliography section at end of notes
- **Estimated**: 2-3 days
- **Dependencies**: None (standalone feature)

#### 2. PDF Annotation Management
**Zotero Implementation**: `AnnotationManager.ts`
- Read PDF annotations (native Zotero and PDF.js)
- Extract annotation data: type, text, comment, page, color
- Support for both PDF and native annotation types

**Obsidian Implementation Plan**:
- Add `PDFAnnotationManager.ts` module
- Use PDF.js or Obsidian's PDF viewer API
- Extract highlights, notes, and comments from PDFs in vault
- Link annotations to specific text in markdown
- Add `/annotations` slash command to attach PDF annotations
- **Estimated**: 3-4 days
- **Dependencies**: None (standalone feature)

#### 3. Enhanced Item/Note Context Extraction
**Zotero Implementation**: `ItemManager.ts`
- Extract metadata from selected Zotero items
- Format item context for Hermes prompts
- Support multiple item selection
- Extractors for: title, creators, date, abstract, tags, URL, DOI

**Obsidian Enhancement Plan**:
- Enhance existing context system with more metadata
- Extract: title, frontmatter, tags, word count, last modified
- Add `/context` command with metadata preview
- Support multiple note selection with batch context
- **Estimated**: 1-2 days
- **Dependencies**: Existing context system

### **Tier 2: Medium Impact, Medium Feasibility** ⭐⭐

#### 4. Tag Suggestions & Auto-Tagging
**Zotero Implementation**: `TagManager.ts`
- Get all library tags with counts
- Add/remove tags from items
- Suggest tags based on title/abstract keyword matching
- Confidence scoring for tag suggestions

**Obsidian Implementation Plan**:
- Add `TagManager.ts` module
- Analyze note content for tag suggestions
- Use NLP for content analysis (title, frontmatter, first paragraph)
- Show suggested tags with confidence scores
- Bulk apply tags to multiple notes
- **Estimated**: 2-3 days
- **Dependencies**: None (standalone feature)

#### 5. Conversation Templates
**Zotero Implementation**: `ConversationManager.ts`
- Persistent conversation storage
- Create/load/save conversations
- Message tracking with timestamps
- Context item association

**Obsidian Enhancement Plan**:
- Enhance existing `VaultManager.ts`
- Add conversation templates (predefined conversation starters)
- Save conversation templates to vault
- Load templates via `/template` slash command
- **Estimated**: 1-2 days
- **Dependencies**: Existing conversation management

#### 6. Better PDF Integration
**Zotero Implementation**: AnnotationManager + PDF support
- PDF.js integration for annotation reading
- PDF metadata extraction
- Page-specific context

**Obsidian Enhancement Plan**:
- Enhance existing PDF attachment support
- Add PDF.js for annotation extraction
- Extract page-specific content from PDFs
- Link PDF annotations to markdown notes
- **Estimated**: 2-3 days
- **Dependencies**: Existing PDF support

### **Tier 3: Low Impact, High Feasibility** ⭐

#### 7. Preference Organization
**Zotero Implementation**: `PreferencesManager.ts`
- Zotero preference-based configuration
- Settings: binary path, connection mode, auto-save, reasoning, typing effects
- Feature toggles: citations, annotations, tags

**Obsidian Enhancement Plan**:
- Minor UI improvements to settings tab
- Better organization of settings sections
- Group related settings together
- **Estimated**: 1 day
- **Dependencies**: None

#### 8. Simplified Approval UI
**Zotero Implementation**: `ApprovalDialog.ts`
- XUL-based approval dialog for note modifications
- Diff display between current and proposed content
- Three options: Approve, Modify, Reject

**Obsidian Enhancement Plan**:
- Learn from Zotero's XUL approach for inspiration
- Current React implementation is already robust
- Could add keyboard shortcuts for approval actions
- **Estimated**: 0.5 days
- **Dependencies**: None

---

## Implementation Priority Matrix

| Feature | Zotero Value | Obsidian Port Difficulty | Obsidian Impact | Priority |
|---------|-------------|-------------------------|-----------------|----------|
| Citation Management | ⭐⭐⭐⭐⭐ | Low | ⭐⭐⭐⭐⭐ | **1** |
| Annotation Management | ⭐⭐⭐⭐⭐ | Medium | ⭐⭐⭐⭐⭐ | **2** |
| Enhanced Context | ⭐⭐⭐⭐ | Low | ⭐⭐⭐⭐ | **3** |
| Tag Suggestions | ⭐⭐⭐⭐ | Low | ⭐⭐⭐⭐ | **4** |
| Conversation Templates | ⭐⭐⭐ | Low | ⭐⭐⭐ | **5** |
| PDF Integration | ⭐⭐⭐⭐ | Medium | ⭐⭐⭐⭐ | **6** |
| Preference Organization | ⭐⭐ | Low | ⭐⭐ | **7** |
| Approval UI Refinement | ⭐⭐ | Low | ⭐⭐ | **8** |

---

## Implementation Timeline

### Week 1 (May 20-26): Foundation
- [ ] Citation Management System (Tier 1)
- [ ] Tag Suggestions & Auto-Tagging (Tier 2)
- [ ] Enhanced Context Extraction (Tier 1)

### Week 2 (May 27-June 2): Advanced Features
- [ ] PDF Annotation Management (Tier 1)
- [ ] Conversation Templates (Tier 2)
- [ ] Better PDF Integration (Tier 2)

### Week 3 (June 3-9): Polish & Refinement
- [ ] Preference Organization (Tier 3)
- [ ] Approval UI Refinement (Tier 3)
- [ ] Testing and documentation

---

## Notes

- All features should follow Obsidian Hermes coding conventions
- TypeScript strict mode must be maintained
- Security considerations: approval system for file modifications
- Test across different Obsidian versions (1.12.3+)
- Update `manifest.json` version after each major feature
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
