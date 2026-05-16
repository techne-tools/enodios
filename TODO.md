# Hermes Plugin Development Todo List

**Created:** 14 May 2026  
**Phase:** Chat UI Enhancement

## Core Features (High Priority)

- [x] Implement message context/references feature
- [x] Add markdown rendering for assistant responses
- [x] Add settings for API configuration
- [x] Implement chat history persistence (vault folder)
- [x] Implement file/note attachment to messages
- [x] Add conversation management (new/clear chat)

## UX Improvements (Medium Priority)

- [x] Implement streaming responses
- [x] Add typing indicator animation (Unicode braille spinner)
- [x] Implement error handling and retry logic
- [x] Add mobile-responsive styling
- [x] Add keyboard shortcuts (Cmd+H toggle, Cmd+Shift+H focus)
- [x] Implement code block syntax highlighting
- [x] Implement rate limiting indicators

## Completed

- [x] Implement message copy/export functionality (via Obsidian native)
- [x] Add agent/model selection (via Hermes tools)
- [x] Implement Hermes /slash commands (use Hermes native tools)
- [x] Create slash commands (use Hermes native tools)
- [x] Implement context/references feature with precise deduplication (15 May 2026)
- [x] Add autocomplete for braces {} and wikilinks [[...]] with filesystem path support (15 May 2026)

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

## Next Steps

1. ✅ Remove dead code and sample scaffolding
2. ✅ Fix type safety issues (strictNullChecks enabled)
3. ✅ Gate console logging and remove debug noise
4. ✅ Fix react-hooks/exhaustive-deps
5. ✅ Remove eslint-disable for no-explicit-any
6. ✅ Bump version to 0.1.0
7. 🔄 Implement permission approval UI in Obsidian (AcpClient)
8. 🔄 Implement actual terminal support (AcpClient)
9. 🔄 Add unit tests for VaultManager and SlashCommands
10. 🔄 Add integration tests for ACP connection flow
