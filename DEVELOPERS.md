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
- **`AuditLog`**: Persistent audit trail recording every tool invocation, file change, permission grant, terminal command, and connection event. Writes are batched (500ms delay) to `hermes/audit-log.md` to avoid excessive I/O.

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
Handles persistence, loading, and export of chat conversations.
- **Organization modes**: `flat` (all in one folder), `by-date` (`hermes/2026-05/`), or `by-project`.
- **Export formats**: HTML (self-contained with escaped output), JSON (with metadata), PDF (via printable blob URL — caller must revoke).
- **Security**: `escapeHtml` properly escapes `&`, `<`, `>`, `"`, `'`, and backticks (`` ` ``) to prevent XSS in exported HTML.

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
