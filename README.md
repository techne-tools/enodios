# Hermes Agent for Obsidian

[![GitHub release](https://img.shields.io/github/v/release/prismatic7/obsidian-hermes)](https://github.com/prismatic7/obsidian-hermes/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/prismatic7/obsidian-hermes/total)](https://github.com/prismatic7/obsidian-hermes/releases)

## Installation

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/prismatic7/obsidian-hermes).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

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
