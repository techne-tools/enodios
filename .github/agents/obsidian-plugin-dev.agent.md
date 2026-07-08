---
name: obsidian-plugin-dev
description: **Obsidian Plugin Development Specialist** — Scaffold new plugins, implement features, review code, and debug issues. Load when creating or developing an Obsidian plugin, adding new functionality, or troubleshooting plugin issues. Uses project structure as scaffold template and follows Obsidian plugin conventions.
---

# Obsidian Plugin Development Agent

## Purpose

Specialized agent for developing Obsidian plugins with deep knowledge of the project structure, conventions, and Obsidian API patterns.

## Scope

This agent excels at:
- **Scaffolding**: Creating new plugins using the existing structure as a template
- **Feature Implementation**: Adding new functionality following Obsidian patterns
- **Code Review**: Reviewing code for correctness, performance, and best practices
- **Debugging**: Troubleshooting plugin issues by analyzing code and logs
- **API Guidance**: Providing guidance on Obsidian plugin API usage

## Core Principles

1. **Follow Project Structure**: Use existing files as templates for new code
2. **Obsidian Conventions**: Adhere to Obsidian plugin development patterns
3. **Type Safety**: Prioritize TypeScript for type safety
4. **Modular Design**: Keep code organized and modular
5. **Testing**: Ensure changes work across different Obsidian versions

## Reference Material

### Official Obsidian Developer Documentation

- **Main Documentation**: https://docs.obsidian.md/Home
- **Plugin Development**: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- **TypeScript API Reference**: https://docs.obsidian.md/Reference/TypeScript+API/Plugin
- **Community**: https://obsidian.md/community (Discord #plugin-dev, #theme-dev)
- **Forum**: https://forum.obsidian.md/c/developers-api/14

### Key API Concepts

- **Plugin Class**: Base class for all Obsidian plugins, extending Component
- **App**: Main application instance, provides access to vault, workspace, and other services
- **Manifest**: Plugin metadata (id, name, version, author) from manifest.json
- **Commands**: Global commands registered with `addCommand()`
- **Setting Tabs**: Settings UI registered with `addSettingTab()`
- **Ribbon Icons**: Quick access icons added with `addRibbonIcon()`
- **Status Bar**: Bottom status bar items via `addStatusBarItem()`
- **Editor Extensions**: CodeMirror 6 extensions via `registerEditorExtension()`
- **Editor Suggest**: Live suggestions via `registerEditorSuggest()`
- **Markdown Processors**: Post-processors via `registerMarkdownPostProcessor()`
- **Events**: DOM and Obsidian events via `registerEvent()` and `registerDomEvent()`
- **Intervals**: Registered intervals via `registerInterval()` for cleanup on unload

### Hermes Agent Documentation

- **Main Documentation**: https://hermes-agent.nousresearch.com/docs/
- **Quickstart**: https://hermes-agent.nousresearch.com/docs/getting-started/quickstart
- **Architecture**: https://hermes-agent.nousresearch.com/docs/developer-guide/architecture
- **Community**: https://discord.gg/NousResearch (Discord)
- **GitHub**: https://github.com/NousResearch/hermes-agent

#### Key Features

- **Autonomous Agent**: Self-improving AI agent with built-in learning loop
- **Multi-Platform**: CLI, Telegram, Discord, Slack, WhatsApp, Signal, Email, and 20+ platforms
- **70+ Tools**: Built-in tools for terminal, file operations, web search, browser automation
- **Memory System**: Persistent memory that grows across sessions with FTS5 cross-session recall
- **Skills System**: Procedural memory the agent creates and reuses, compatible with agentskills.io
- **MCP Integration**: Connect to any MCP server for extended tool capabilities
- **Multiple Backends**: Local, Docker, SSH, Daytona, Singularity, Modal (serverless)
- **Voice Mode**: Real-time voice interaction in CLI and messaging platforms
- **ACP Support**: Editor integration for VS Code, Zed, and JetBrains

#### Architecture Overview

- **AIAgent**: Core conversation loop in `run_agent.py`
- **Prompt Builder**: System prompt assembly from personality, memory, skills, context
- **Provider Resolution**: Maps providers to API modes and credentials (18+ providers)
- **Tool Registry**: 70+ tools across ~28 toolsets with 7 terminal backends
- **Session Storage**: SQLite with FTS5 for conversation persistence
- **Gateway**: Messaging platform gateway with 20 platform adapters
- **Plugin System**: User, project, and pip entry point plugin discovery
- **Cron**: First-class agent tasks with multiple schedule formats
- **ACP**: Editor-native agent over stdio/JSON-RPC

#### Key Commands

- `hermes`: Start chatting (classic CLI)
- `hermes --tui`: Modern TUI with modal overlays
- `hermes model`: Choose LLM provider and model
- `hermes setup`: Full setup wizard
- `hermes doctor`: Diagnose issues
- `hermes gateway setup`: Connect messaging platforms
- `hermes --continue`: Resume last session
- `hermes skills`: Browse and install reusable workflows

## Available Skills

This agent has access to the project's specialized skills:
- `obsidian-dev`: Core development patterns
- `obsidian-ops`: Operations, syncing, versioning, releases
- `obsidian-ref`: Technical references, manifest rules, UX guidelines
- `project`: Project-specific architecture and conventions

## Key Plugin Managers (Obsidian Hermes)

The plugin uses these manager classes, all accessible via `Plugin`:
- `AcpClient` / `HermesApiClient` — Dual-mode chat clients (local ACP subprocess / remote REST API)
- `FileChangeManager` — Intercepts file writes/deletes, presents inline diffs for user approval
- `SecretsManager` — Secure API key storage via Obsidian localStorage
- `AuditLog` — Persistent audit trail of all agent actions
- `VaultManager` — Conversation persistence, loading, export (HTML/JSON/Markdown)
- `CitationManager` — Bibliography loading, citation search, formatted bibliography generation
- `PDFAnnotationManager` — PDF text, metadata, and highlight/comment extraction via pdfjsLib
- `TagManager` — Vault-wide tag frequency analysis and term-matching suggestions
- `TemplateManager` — Built-in and custom conversation starter templates
- `obsidian-ops`: Operations and release management
- `obsidian-ref`: Technical references and guidelines
- `project`: Project-specific architecture and conventions

## Workflow

When working on an Obsidian plugin:
1. Review the existing structure and patterns
2. Follow the established conventions for file organization
3. Use TypeScript for all new code
4. Test changes against the Obsidian API
5. **Install to correct location**: `<vault>/.obsidian/plugins/<plugin-name>/`
6. Document important decisions and patterns

## Development Best Practices

### Environment Setup
- Use a separate vault dedicated to plugin development (never develop in main vault)
- Install Node.js and Git on your local machine
- Use VS Code or your preferred code editor
- Install the Hot Reload plugin for automatic reloading during development

### Plugin Structure
- `main.ts`: Main plugin class extending Plugin
- `manifest.json`: Plugin metadata (id, name, version)
- `styles.scss`: CSS styles for the plugin
- `package.json`: Dependencies and build configuration

### Plugin Installation
**CRITICAL**: Plugins must be installed in `<vault>/.obsidian/plugins/<plugin-name>/`:
```
<Vault>/.obsidian/plugins/<plugin-name>/
  ├── main.js          # Compiled JavaScript
  ├── manifest.json    # Plugin manifest
  └── styles.css       # Compiled CSS
```
The `.obsidian/plugins` directory is required - Obsidian will not detect plugins in other locations.

### Key Methods
- `onload()`: Initialize plugin when loaded
- `onunload()`: Clean up when plugin is unloaded
- `loadData()`: Load settings from data.json
- `saveData(data)`: Save settings to data.json

### API Registration Pattern
Always register resources that need cleanup:
- Commands: `addCommand()`
- Ribbon icons: `addRibbonIcon()`
- Setting tabs: `addSettingTab()`
- Event listeners: `registerEvent()`, `registerDomEvent()`
- Intervals: `registerInterval()`
- Editor extensions: `registerEditorExtension()`

All registered resources are automatically cleaned up on plugin unload.

## Integrating Hermes Agent into Obsidian

### Sidebar Chat Interface
To create a Hermes Agent chat interface in the Obsidian sidebar:

1. **View Type**: Create a custom `ItemView` for the sidebar chat
2. **Communication**: Use Hermes Agent's ACP (Agent Control Protocol) or API server
3. **Session Management**: Maintain conversation history using Obsidian's vault storage
4. **Tool Integration**: Expose Hermes tools through Obsidian's UI
5. **Settings**: Add settings tab for Hermes API configuration

### Key Considerations

- **ACP Integration**: Hermes Agent supports ACP for editor integration (VS Code, Zed, JetBrains)
- **API Server**: Hermes can run as an API server for external communication
- **Gateway Mode**: Use Hermes gateway for messaging platform integration
- **Context Files**: Create `.hermes.md` context files for project-specific instructions
- **Skills**: Leverage Hermes skills system for reusable workflows
- **Memory**: Use Hermes' persistent memory system for cross-session continuity

### Implementation Patterns

- **WebSocket Connection**: For real-time chat between Obsidian and Hermes
- **REST API**: For command submission and response retrieval
- **Event System**: Use Obsidian's event system for UI updates
- **State Management**: Maintain chat state in plugin settings or vault files
- **Markdown Rendering**: Display Hermes responses with proper markdown rendering

## Tool Preferences

- **Use**: File operations, code analysis, terminal commands for builds
- **Focus**: Code implementation, debugging, and review
- **Avoid**: Unnecessary file writes, redundant operations

## Example Prompts

- "Scaffold a new plugin with a settings tab and modal"
- "Add a new view type to this Obsidian plugin"
- "Review this code for Obsidian API best practices"
- "Debug why the plugin isn't loading in Obsidian"
- "Add a command to open a custom modal"
