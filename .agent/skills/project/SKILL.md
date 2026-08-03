---
name: project
description: Project-specific architecture, maintenance tasks, and unique conventions. Load when performing project-wide maintenance or working with the core architecture.
---

# Project Context

This skill provides the unique context and architectural details for this repository.

## Purpose

To provide guidance on project-specific structures and tasks that differ from general Obsidian development patterns.

## When to Use

Load this skill when:
- Understanding the repository's unique architecture.
- Performing recurring maintenance tasks.
- Following project-specific coding conventions.

## Project Overview

- **Primary Stack**: TypeScript, React 18, CodeMirror 6, Obsidian Plugin API, Agent Client Protocol (ACP) CLI subprocess, Vitest, esbuild.
- **Key Directories**:
  - `src/`: Core plugin code and client logic.
  - `src/Modals/`: Modal dialogs (CitationSuggestModal, TagSuggestionModal).
  - `src/Views/`: HermesChatView implementation.
  - `src/Views/Components/`: Reusable components for HermesChatView (ChatHeader, AuditLogPanel, ChatMessageItem, MessageList).
  - `src/Views/Hooks/`: Custom React hooks for HermesChatView (useSlashCommands, useAutocomplete).
  - `src/__tests__/`: Unit tests for components and hooks.
  - `src/styles/`: SCSS styling and CodeMirror 6 inline diff/ghost text extensions.
  - `src/utils/`: Utility modules (contextEnhancer, blockReferences, uuid).
  - `src/__tests__/`: Vitest-based unit testing suite.
  - `dist/`: Compiled production bundles.

## Core Architecture

- **Plugin Lifecycle**: `Plugin.ts` registers command palette callbacks, settings pane (`PluginSettingsTab`), the right sidebar leaf (`HermesChatView`), and editor decorations.
- **Agent Integration**:
  - **Local Subprocess**: `AcpClient` spawns the Hermes CLI to execute prompts and handle interactive shell/permission commands using stdin/stdout.
  - **Remote Server**: `HermesApiClient` connects to a remote Hermes deployment via stateless HTTP post requests and Server-Sent Events (SSE).
- **User Approval Pipeline**: `FileChangeManager` captures all file edit/deletion suggestions from the agent, holding them as pending. The user can review, partial-approve, or reject changes via an inline CodeMirror unified diff before files are written.
- **Academic & Utility Managers**:
  - `CitationManager`: Loads `.bib`/CSL JSON bibliography files, searches citations, generates formatted bibliographies (APA, MLA, Chicago, IEEE).
  - `PDFAnnotationManager`: Extracts highlights, comments, metadata, and page text from PDFs using Obsidian's built-in `pdfjsLib`.
  - `TagManager`: Scans vault-wide tags with term-frequency matching to suggest relevant tags for notes.
  - `TemplateManager`: Loads built-in and user-custom conversation starter templates from `hermes/templates/`.
- **Context Enhancement**: `contextEnhancer.ts` enriches note context with word count, tags, frontmatter, and backlinks before sending to the agent.

## Project-Specific Conventions

- **Module System**: Strictly utilizes standard ES modules with `.ts` extensions inside imports (`import { ... } from './AcpClient.ts'`).
- **Typing Strictness**: Strictly inherits `@tsconfig/strictest`. Always use precise parameter types and handle `undefined` or `null` returns cleanly.
- **Unit Testing**: All classes/managers have companion unit tests inside `src/__tests__/`. Mocks for Obsidian objects are managed in `src/__tests__/mocks/`.

## Plugin Installation

**CRITICAL**: Plugins must be installed in `<vault>/.obsidian/plugins/hermes/`:
```
<Vault>/.obsidian/plugins/hermes/
  ├── main.js          # Compiled JavaScript
  ├── manifest.json    # Plugin manifest
  └── styles.css       # Compiled CSS
```

The `.obsidian/plugins` directory is required - Obsidian will not detect plugins in other locations.

## Key Files

- `manifest.json`: Plugin manifest (configured with id: `hermes`, `isDesktopOnly: true`).
- `package.json`: NPM package configuration containing dependencies (`@agentclientprotocol/sdk`, `prismjs`) and build utilities.

## Maintenance Tasks

- `pnpm dev`: Start esbuild watcher to compile on the fly.
- `pnpm build`: Perform full compilation and lint check.
- `pnpm lint`: Run ESLint analysis.
- `pnpm test`: Run the Vitest suite synchronously.

