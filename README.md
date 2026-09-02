# Enodios for Obsidian

Chat with the Hermes autonomous AI agent inside Obsidian. Enodios connects your vault to a Hermes agent so you can search notes, get inline writing suggestions, and let the agent read and edit files — with your approval.

## What you can do

- **Chat with your vault**: type `/search [query]` to find notes and attach matching excerpts to the conversation. Use `/search semantic [query]` for meaning-based results via Hermes embeddings (API mode) or a local Ollama model — see the Embedding Provider setting.
- **Inline suggestions**: run "Enodios: Trigger Inline Suggestion" while typing to get ghost-text completions. Press `Tab` to accept.
- **Canvas support**: open a canvas and type `/canvas` to bring its structure into the chat.
- **Citations and PDFs**: manage a bibliography, format references (APA, MLA, Chicago, IEEE), and pull text or highlights from PDFs.
- **Tag suggestions**: `/tags suggest` scans your notes and offers matching tags to write into the frontmatter.
- **Templates and personas**: save prompts with `/template save` and switch instructions with `/persona`.

## How safety works

The agent can create and modify files, but every change appears in a diff view for you to approve or reject — individually or in bulk. Terminal access is off by default, and the agent's actions are logged to `enodios/audit-log.md` while Debug Mode is enabled.

## Security & permissions

Enodios is a **local agent bridge** — it runs a subprocess and reads data from outside the vault. Please read this before installing:

- **Shell execution (off by default)**: In ACP mode, Enodios spawns your local Hermes binary. Terminal access is disabled unless you enable it, and the plugin never enables it on your behalf.
- **Filesystem access**: Enodios reads `~/.hermes/` to discover your Hermes profiles and locate the Hermes binary. It does not otherwise read or write files outside the vault — the *agent it spawns* decides what to access, and its file changes appear in the diff view for approval.
- **Vault enumeration**: Enodios indexes and enumerates your vault (`getMarkdownFiles`, `getFiles`) to power semantic search, tag management, templates, and slash commands. Your notes do not leave your machine unless you connect via API mode to a remote Hermes agent.
- **Privacy**: The plugin sends no telemetry and makes no network requests of its own. In API mode, requests go only to the Hermes agent URL you configure.

All file changes are gated behind the review-and-approve diff flow described above.

## Connections

- **ACP**: runs a local Hermes subprocess (requires the Hermes binary).
- **API**: connects to a remote Hermes agent over HTTP/SSE.

MCP servers are configured in Hermes itself (`hermes mcp`), not in this plugin. The plugin connects to whatever servers your Hermes profile has enabled.

## Installation

The plugin isn't in the official Community Plugins list yet. To install the beta:

1. Install and enable the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat).
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/techne-tools/enodios).
3. In the Obsidian popup, click `Add plugin` and wait a few seconds.

## Getting started

1. Open **Settings > Enodios**.
2. Choose a connection mode (ACP for local, API for remote) and click **Test Connection**.
3. Open the chat from the ribbon icon, or run the "Open Chat" command.

## License

© Enodios contributors
