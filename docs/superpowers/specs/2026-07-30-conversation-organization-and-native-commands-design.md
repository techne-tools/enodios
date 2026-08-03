# Design Spec: Conversation Organization & Native Slash Commands

* **Date**: 2026-07-30
* **Topic**: Implementing tag-based conversation folder organization and native programmatic slash commands.

---

## 1. Project Organization (`by-project` setting)

### 1.1 Resolution Logic
When saving or updating a conversation file under the `by-project` mode, the destination subfolder is resolved dynamically:
1. **Active Note Tags**: Retrieve the tags of the active note open in the workspace editor. First check frontmatter tags, then inline tags.
2. **Conversation Tags**: If the active note has no tags, scan the conversation messages for any `#tag` references.
3. **Fallback**: If no tags are found, default to a folder named `general/`.

Tag names are cleaned by removing `#`, lowercasing, replacing non-alphanumeric characters with hyphens (except for `/` to support hierarchical tags), and trimming.

### 1.2 Dynamic Re-organization
In `VaultManager.updateConversation()`, if the resolved file path differs from the current file path (e.g. because a tag has been added to the active note or conversation), the file is programmatically renamed/moved to the new folder.

---

## 2. Programmatic Slash Commands

Refactor placeholder slash commands into native programmatic actions:

### 2.1 `/git push`
* **Implementation**: Uses `execSync` to run `git push` inside the vault base directory and returns stdout/stderr directly in the chat view.

### 2.2 `/admonition insert <type> [title]`
* **Implementation**: Programmatically inserts a Markdown callout block at the cursor in the active editor:
  ```markdown
  > [!type] title
  > 
  ```

### 2.3 `/table generate [cols] [rows]`
* **Implementation**: Programmatically generates a formatted Markdown table of specified dimensions (default: 3x2) and inserts it at the cursor.

### 2.4 `/table format`
* **Implementation**: Programmatically executes the Advanced Tables command `table-editor-obsidian:format-table` via `app.commands.executeCommandById`.

### 2.5 `/bases create <name>`
* **Implementation**: Creates a new `.base` YAML database file with a default table view, saves it to the vault, and opens it in a new leaf.
