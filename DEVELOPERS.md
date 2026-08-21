# Developer Guide

Welcome! This document outlines the architecture, tech stack, and workflows for contributing to the Obsidian Hermes plugin.

## Tech Stack

- **Runtime**: Obsidian Plugin API
- **Language**: TypeScript
- **UI Framework**: React 18 (via `createRoot`)
- **Styling**: SCSS
- **Agent Protocol**: `@agentclientprotocol/sdk` (ACP)
- **Build Tool**: `obsidian-dev-utils` (Webpack/esbuild wrapper)
- **Testing**: Vitest

## Getting Started

1. **Clone the repository** directly into a test vault for the easiest workflow:
   ```bash
   cd /path/to/your/test-vault/.obsidian/plugins/
   git clone https://github.com/prismatic7/obsidian-hermes.git hermes
   cd hermes
   ```
2. **Install dependencies**:
   ```bash
   pnpm install
   ```
3. **Start the development watcher**:
   ```bash
   pnpm run dev
   ```
   *Note: It is highly recommended to use the Hot Reload plugin in your test vault to automatically reload the plugin when `main.js` is rebuilt.*

## Architecture Overview

### 1. Dual-Mode Chat Client (`src/ChatClient.ts`)
The plugin communicates with the Hermes agent using an abstracted `ChatClient` interface.
- **`AcpClient.ts`**: Manages a stateful `ChildProcess`. It communicates over `stdio` using `ndjson`. It intercepts tool calls (like file writes) and proxies them to the `FileChangeManager`.
- **`HermesApiClient.ts`**: A stateless REST client connecting to the agent's `/v1/chat/completions` endpoint via Server-Sent Events (SSE).

### 2. React UI Integration (`src/Views/HermesChatView.tsx`)
Instead of manual DOM manipulation, the entire sidebar chat interface is a React component tree mounted via React 18's `createRoot()`.
- Event listeners from the `ChatClient`, `FileChangeManager`, and Obsidian Workspace are synchronized into React state using `useEffect` hooks.
- Avoid putting heavy synchronous logic directly in the state setters to prevent blocking the UI thread.

### 3. File Change & Security Managers
- **`FileChangeManager`**: Intercepts `writeTextFile` and `deleteTextFile` calls from the agent. It stores them in memory and renders a `PendingChangesPanel` containing inline diffs. Changes are only committed to the `app.vault` after user approval.
  - **Partial Approval**: Users can select individual lines in the diff via checkboxes. The diff is snapshotted at registration time (`diffSnapshot`) to prevent race conditions if the file changes while the user is reviewing.
  - **Bulk Actions**: "Approve All" and "Reject All" buttons for handling multiple changes at once, with atomic path-level locking to prevent concurrent writes.
- **`SecretsManager`**: Uses Obsidian's `loadLocalStorage`/`saveLocalStorage` specifically for handling remote API keys so they are never stored in plaintext `data.json`.
  - **Security Warning**: localStorage is NOT encrypted. Secrets are stored in plaintext in the user's profile directory. API keys are revokable, which mitigates the risk, but users should rotate keys regularly and avoid storing non-revokable credentials.
- **`AuditLog`**: Persistent audit trail recording every tool invocation, file change, permission grant, terminal command, and connection event. Writes are batched (500ms delay) to `hermes/audit-log.md` to avoid excessive I/O.
  - **Security Warning**: The audit log contains sensitive information (file paths, command arguments, API errors) and is stored as plaintext in the vault. Users should not share it publicly.

### Security Architecture

#### Path Traversal Protection (`isPathSafe`)
All file paths from the agent are validated before access:
- Rejects paths starting with `..` or `/` (absolute paths)
- Rejects paths containing `../` (parent directory traversal)
- Rejects null bytes and control characters (`\x00-\x1f`)
- Rejects Windows absolute paths (`C:\`, `D:\`, etc.) and UNC paths (`\\server\share`)
- **Known Limitation**: Symlink traversal is not checked. If the vault contains a symlink to a sensitive directory, the agent can traverse it. Future versions should use `fs.realpath()` to resolve symlinks.

#### Shell Command Sanitization (`sanitizeShellCommand`)
Terminal commands are restricted to a curated allowlist:
- **Allowed commands**: `cat`, `echo`, `grep`, `ls`, `mkdir`, `touch`
- **Per-command argument allowlists**: each command only accepts known-safe argument prefixes (e.g. `grep -i -n -r -w -l -c -v -E -F`, `ls -a -l -h -t -r -S -1 -F`, `mkdir -p -v -m`); any other argument is rejected.
- **Rejected**: All shells (bash, zsh, fish), script interpreters (python, node, ruby), and any command not in the allowlist — including `git`, `curl`, `wget`, `find`, `rm`, `cp`, `mv`, which are deliberately excluded (destructive or exfiltration-capable).
- **Argument validation**: Every argument is checked against dangerous patterns:
  - `-c`, `--command`, `-e`, `--eval`, `-exec` (code execution flags)
  - `|`, `;`, `&&`, `||` (shell metacharacters)
  - `$(`, `` ` ``, `${`, `>>`, `<(` (command substitution, redirection)
- **Security Note**: This is defense-in-depth. With `shell: false`, arguments are passed directly to the executable, but some "safe" commands have configuration options that enable arbitrary code execution. The argument sanitizer catches these.

#### MCP Server Validation (`validateMcpServerPath`)
MCP server executables are validated before being passed to the agent:
- Must be absolute paths (no relative paths)
- Cannot be in temporary directories (`/tmp`, `/var/tmp`, `/dev/shm`, `/run`)
- Cannot be world-writable files (`statSync().mode & 0o002`)
- Invalid servers are logged to the audit log and skipped

#### Permission Auto-Approval (`autoApproveSingleOptionPermissions`)
By default, ALL permission requests require explicit user approval. A setting (`autoApproveSingleOptionPermissions`, default: `false`) enables auto-approval for permissions with exactly one "allow" option. This is a convenience feature that reduces security — only enable if you completely trust the agent.

#### Rate Limiting
Both `AcpClient` and `HermesApiClient` enforce a 1-second rate limit on `sendPrompt()` to prevent accidental or malicious prompt flooding.

#### Secret Redaction in Debug Logs
`DebugLogger` automatically redacts common secret patterns from all output:
- Bearer tokens: `Bearer abc123...` → `Bearer [REDACTED]`
- API keys in query strings: `api_key=abc123` → `api_key=[REDACTED]`
- Authorization headers: `Authorization: Basic abc123` → `Authorization: [REDACTED]`
- Password fields in JSON: `"password": "secret"` → `"password": "[REDACTED]"`

### 4. Streaming & Performance (`src/Views/useStreamBuffer.ts`)
Buffers rapid SSE/ACP stream chunks and flushes them into React state via `requestAnimationFrame` to avoid UI stutter.
- Optional typing sounds (Web Audio API) and haptic feedback (`navigator.vibrate`) with throttling (~20/sec max).
- Tracks streaming message IDs for content and reasoning separately.

### 5. CodeMirror 6 Ghost Text (`src/styles/GhostTextExtension.ts`)
Provides inline auto-completion suggestions directly in the markdown editor.
- Triggered via the `Hermes: Trigger Inline Suggestion` command or automatically.
- Supports multiple alternatives cycled with `Alt+ArrowRight`.
- Accept with `Tab` — inserts text and clears the decoration.
- Clears automatically if the user types or moves the cursor.

### 6. Block-Level References (`src/utils/blockReferences.ts`)
Parses markdown to extract specific blocks (headings, code blocks, lists, block IDs) for smart context embedding.
- Supports `[[Note#Heading]]` syntax and block ID references (`^block-id`).
- Used by both `AcpClient` and `HermesApiClient` when resolving context items to send only relevant sections instead of entire notes.

### 7. Conversation Management (`src/VaultManager.ts`)
Handles persistence and loading of chat conversations.
- **Organization modes**: `flat` (all in one folder), `by-date` (`enodios/2026-05/`), or `by-project`.
- **Note**: Export (HTML/JSON/Markdown/PDF) was removed in 0.4.1-beta1 and has not been restored. Conversations are plain markdown notes with YAML frontmatter, so they can be copied, templated, or re-purposed directly in the vault.

### 8. Academic & Utility Managers
- **`PDFAnnotationManager`** (`src/PDFAnnotationManager.ts`): Integrates `pdfjs-dist` to extract plain text per page, parse metadata, and pull highlights/comments from embedded PDF annotations.
- **`TagManager`** (`src/TagManager.ts`): Implements an term-frequency keyword matching heuristic against vault-wide tags. Suggestions are presented to the user via a React-based checklist modal (`TagSuggestionModal.tsx`) and committed directly to the note frontmatter.
- **`TemplateManager`** (`src/TemplateManager.ts`): Loads pre-configured built-in templates and user custom prompts (from `hermes/templates/`) supporting frontmatter metadata. Starters are rendered in empty chat views as clickable cards.
- **`contextEnhancer`** (`src/utils/contextEnhancer.ts`): Generates enriched note context including word count, character count, tags, YAML frontmatter, created/modified timestamps, and backlinks. Used by both `AcpClient` and `HermesApiClient` when sending note context to the agent.

### 9. Unified Keyboard Hotkeys & Focus Flow
- **Diff Reviews**: Keyboard events are bound in `PendingChangesPanel` (`src/Views/HermesChatView.tsx`) to approve/reject changes quickly (`⌘⇧A`, `⌘⇧R`, `⌘Enter`, `Esc`).
- **Sidebar Chat Actions**: Context-aware window keydown listeners support quick session controls:
  - `⌘⌥C`: Reset and start a New Chat.
  - `⌘⌥L`: Toggle Previous Conversations sidebar drawer.
  - `⌘⌥S`: Toggle Session Tools drawer.
  - `⌘⌥E`: Toggle Reasoning Visibility bubble filters.

## AI Agent Setup (For AI Coding Assistants)

If you are using an AI coding assistant (like GitHub Copilot, Gemini Code Assist, or Cursor), this repository is heavily optimized for agentic development.

*   **`.agent.md`**: Defines the project-wide system prompts and loads relevant skills.
*   **`.github/agents/obsidian-plugin-dev.agent.md`**: Provides the LLM with deep context on the Obsidian Plugin API, common lifecycle patterns (`onload`, `registerEvent`), and strict instructions on how to handle Obsidian's UI safely.
*   **`.agent/skills/`**: Contains modular markdown references (`obsidian-dev`, `obsidian-ops`, `obsidian-ref`) that guide the AI on testing strategies, build workflows, and UX copy.

## Testing

We use `Vitest` for testing. You'll find a heavily mocked `obsidian` module in `src/__tests__/__mocks__/obsidian.ts`.

Run the test suite:
```bash
pnpm run test
```

## Code Style & Linting

Ensure your code passes the strict formatting and linting rules before submitting a PR.
```bash
pnpm run format
pnpm run lint
```
