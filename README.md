# Enodios for Obsidian

Chat with the Hermes autonomous AI agent inside Obsidian. Enodios connects your vault to a Hermes agent so you can search notes, get inline writing suggestions, and let the agent read and edit files — with your approval.

## What you can do

- **Chat with your vault**: type `/search [query]` to find notes and attach matching excerpts to the conversation.
- **Inline suggestions**: run "Enodios: Trigger Inline Suggestion" while typing to get ghost-text completions. Press `Tab` to accept.
- **Canvas support**: open a canvas and type `/canvas` to bring its structure into the chat.
- **Citations and PDFs**: manage a bibliography, format references (APA, MLA, Chicago, IEEE), and pull text or highlights from PDFs.
- **Tag suggestions**: `/tags suggest` scans your notes and offers matching tags to write into the frontmatter.
- **Templates and personas**: save prompts with `/template save` and switch instructions with `/persona`.
- **Export conversations** as HTML, JSON, or Markdown.

## How safety works

The agent can create and modify files, but every change appears in a diff view for you to approve or reject — individually or in bulk. Terminal access is off by default, and the agent's actions are logged to `hermes/audit-log.md`.

## Connections

- **ACP**: runs a local Hermes subprocess (requires the Hermes binary).
- **API**: connects to a remote Hermes agent over HTTP/SSE.

You can attach MCP servers in settings to give the agent extra tools. Only add MCP servers you trust — they can run programs on your computer.

## Installation

The plugin isn't in the official Community Plugins list yet. To install the beta:

1. Install and enable the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat).
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/prismatic7/enodios).
3. In the Obsidian popup, click `Add plugin` and wait a few seconds.

## Getting started

1. Open **Settings > Enodios**.
2. Choose a connection mode (ACP for local, API for remote) and click **Test Connection**.
3. Open the chat from the ribbon icon, or run the "Open Enodios Chat" command.

## License

© prismatic7
