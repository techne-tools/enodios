# Hermes Agent for Obsidian

[![GitHub release](https://img.shields.io/github/v/release/prismatic7/obsidian-hermes)](https://github.com/prismatic7/obsidian-hermes/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/prismatic7/obsidian-hermes/total)](https://github.com/prismatic7/obsidian-hermes/releases)

Bring the power of the **Hermes autonomous AI agent** directly into your Obsidian vault.

Obsidian Hermes deeply integrates the agent into your workflow, allowing it to seamlessly read your notes, write files, manage your canvas mind-maps, and even auto-complete your thoughts directly in the markdown editor—all while keeping you firmly in control with a robust security and approval system.

## ✨ Core Features

### 🧠 Semantic Vault RAG (Retrieval-Augmented Generation)
No more copy-pasting your notes. Simply type `/search [query]` in the chat to instantly retrieve and attach contextually relevant excerpts from across your entire vault directly into the agent's context.

### 📝 Deep Editor Integration (Ghost Text)
Use the **"Hermes: Trigger Inline Suggestion"** command while typing in any markdown file to generate Copilot-style "ghost text" auto-completions. Press `Tab` to accept the agent's suggestion and seamlessly integrate it into your writing.

### 🎨 Canvas Support
Hermes understands Obsidian Canvas! Open a mind-map and type `/canvas` to inject its structure into the chat. Hermes can natively read and output `.canvas` files to help you brainstorm visually.

### 🛡️ Security First (File Change Approvals)
Hermes can create and modify files, but it **cannot overwrite your work without permission**. All file modifications are caught by the `FileChangeManager` and presented in the chat UI as an interactive Diff viewer. You can approve or reject changes individually or in bulk.

**Partial Approval**: Select specific lines in the diff via checkboxes to approve only the changes you want. The diff is snapshotted at creation time to prevent race conditions.

### 📊 Token Usage Dashboard
Keep track of your API usage with the real-time token counter in the chat footer. See input/output tokens and estimated cost per conversation. Parsed from the agent's `usage_update` events.

### 🔍 Conversation Search
Press `Cmd+F` in the chat to search through all messages with real-time filtering, match counter, and up/down navigation. Perfect for finding that one piece of advice Hermes gave 50 messages ago.

### 🎨 Persona Templates
Switch between pre-configured personas (Coding Assistant, Writing Coach, Research Assistant) using the `/persona` slash command. Each persona has its own system prompt and default tool set. Customize or create your own in Settings.

### 📤 Export Conversations
Export your conversations in multiple formats:
- **HTML**: Self-contained file with all messages, perfect for sharing or archiving.
- **JSON**: Structured data with metadata for programmatic access.
- **PDF**: Print-friendly format via your browser's print-to-PDF (blob URL — remember to close the tab to free memory).

### 🔌 Dual-Mode Connection
Connect to your Hermes agent exactly how you prefer:
1. **ACP (Agent Client Protocol)**: Spawns a local, lightning-fast subprocess (`hermes acp`) that communicates directly over stdio without needing network ports.
2. **API (REST Server)**: Connect to a remote Hermes agent running on a server via standard HTTP/SSE.

### 🛠️ Model Context Protocol (MCP) Support
Easily extend Hermes' capabilities by attaching local MCP servers in the plugin settings. Give your agent the ability to search the web, query databases, or fetch GitHub PRs natively.

**⚠️ Security Warning on MCP Servers ⚠️**

Configuring local MCP servers allows the Hermes agent to execute external programs on your computer. **You must only configure MCP servers from sources you fully trust.** An untrusted MCP server could execute arbitrary code, read or delete any files on your system, or exfiltrate sensitive data, potentially bypassing the plugin's file change approval system if it makes direct system calls. Exercise extreme caution.

---

## 🚀 Getting Started

1. **Install the plugin** (see instructions below).
2. **Open Settings**: Navigate to `Settings > Hermes` in Obsidian.
3. **Choose Connection Mode**:
   - *For local usage:* Select **ACP**. Ensure the Hermes binary is installed on your system. If it's not in your system PATH, provide the absolute path to the binary.
   - *For remote usage:* Select **API** and enter your Hermes API URL and secure API key.
4. **Click "Test Connection"** to verify everything is working.
5. **Open the Chat**: Click the message bubble icon in your left ribbon menu, or run the "Open Hermes Chat" command.

### 💬 Chat Commands & Usage
- Type `{` or `[[` to instantly auto-complete files and folders into your prompt context.
- Use the **Session Tools** (wrench icon in the chat header) to restrict which tools Hermes is allowed to use on a per-conversation basis.
- Hover over any of your previous messages to reveal the **Edit** button. Editing a message truncates the chat history and branches the conversation.
- If you enable **Terminal Access** in settings, Hermes can run shell commands. You can view the live stdout stream directly in the chat and use the 🛑 **Abort** button to kill runaway processes.
- **Command Palette**: Use "Ask Hermes about selection", "Summarize current note", or "Generate tags" for quick actions without opening the chat.
- **Export**: Click the download icon in the chat header to export as HTML, JSON, or PDF.
- **Search**: Press `Cmd+F` in the chat to search through all messages.
- **Personas**: Type `/persona` to switch between coding, writing, and research assistants.

### ⚙️ Settings Reference
| Setting | Description | Default |
|---------|-------------|---------|
| `connectionMode` | ACP (local) or API (remote) | `acp` |
| `allowTerminal` | Enable terminal command execution | `false` |
| `showReasoning` | Display agent reasoning steps | `false` |
| `showToolUse` | Display tool invocation details | `false` |
| `enableTypingSound` | Audio feedback during streaming | `false` |
| `enableHapticFeedback` | Haptic feedback (mobile) | `false` |
| `conversationOrganization` | `flat`, `by-date`, or `by-project` | `flat` |
| `hasSeenOnboarding` | Whether user dismissed welcome panel | `false` |

---

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/prismatic7/obsidian-hermes).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Troubleshooting & Development

- Experiencing issues connecting? See TROUBLESHOOTING.md.
- Want to contribute or build your own features? Read DEVELOPERS.md.

---

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command in the `DevTools Console`:

```js
window.DEBUG.enable('hermes');
```

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils/blob/main/docs/debugging.md).

## Known Limitations

### Slash Command Autocomplete for MCP Tools

The Hermes ACP adapter only reports a subset of built-in slash commands (e.g. `/tools`, `/version`, `/model`) via the `available_commands_update` protocol message. **MCP tools** (such as `mcp_homebrew_info`, `mcp_browser_navigate`, etc.) are not included in this update, even though they are executable by the agent.

**Impact:**

- Typing `/tools` will list all available tools in the chat pane, but this output is rendered as plain text, not as structured autocomplete options.
- The slash-command dropdown will show cached built-in commands, but will not surface the full set of 148+ MCP tools.
- You can still invoke any MCP tool by typing its full name (e.g. `/mcp_homebrew_info`) and pressing Enter. The plugin will forward the command to the agent, which will execute it correctly.

**Workaround:**

Use `/tools` to view the full list, then type the exact tool name you want to use. The plugin accepts any `/command` pattern and sends it to the agent.

**Root Cause:**

This is a limitation in the Hermes ACP adapter, not in this plugin or the ACP protocol itself. The adapter should enumerate all registered tools (including MCP ones) and include them in `available_commands_update`.

## License

© [Enodios contributors](https://github.com/prismatic7/)
