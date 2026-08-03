# Conversation Organization & Native Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tag-based project folder organization for conversations, and replace placeholder slash commands with native programmatic integrations.

**Architecture:** Update `VaultManager.ts` to resolve tag-based folders using active note or conversation tags and handle dynamic renaming on update. Add native actions for git, admonitions, tables, and bases to `CommunityPluginsManager` and `BasesManager`, and wire them into `SlashCommands.ts`.

**Tech Stack:** TypeScript, Node child_process, Obsidian API, Vitest.

## Global Constraints
- Strictly use standard ES modules with `.ts` extensions inside imports.
- Maintain `@tsconfig/strictest` compliance.
- All classes and managers must have companion tests inside `src/__tests__/`.

---

### Task 1: VaultManager Tag Resolution

**Files:**
- Modify: `src/VaultManager.ts`

**Interfaces:**
- Consumes: `Plugin` settings for `conversationOrganization` and `chatSaveFolder`.
- Produces: `getProjectFolder(messages?: ChatMessage[]): string` and `cleanTagForFolder(tag: string): string` private helpers.

- [ ] **Step 1: Write the tag cleaning helper and resolution logic in `VaultManager.ts`**
  Add the following methods inside the `VaultManager` class:
  ```ts
  private getProjectFolder(messages?: ChatMessage[]): string {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile) {
      const cache = this.plugin.app.metadataCache.getFileCache(activeFile);
      const rawTags = cache?.frontmatter?.['tags'] || cache?.frontmatter?.['tag'];
      if (rawTags) {
        const tags = Array.isArray(rawTags) ? rawTags.map(String) : String(rawTags).split(/,\s*/);
        const tag = tags.find((t) => t.trim());
        if (tag) return this.cleanTagForFolder(tag);
      }
      if (cache?.tags && cache.tags.length > 0) {
        const tag = cache.tags[0]?.tag;
        if (tag) return this.cleanTagForFolder(tag);
      }
    }

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const match = /#([a-zA-Z0-9_\-\/]+)/.exec(msg.content);
        if (match?.[1]) {
          return this.cleanTagForFolder(match[1]);
        }
      }
    }

    return 'general';
  }

  private cleanTagForFolder(tag: string): string {
    return tag
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_\-\/]+/g, '-')
      .replace(/^-|-$/g, '')
      .trim();
  }
  ```

- [ ] **Step 2: Update `generateFilePath` signature and implementation**
  Modify `generateFilePath` and its calls inside `saveConversation` and `updateConversation` to accept `messages` and resolve the path under `by-project` setting:
  ```ts
  private generateFilePath(title: string, timestamp: number, messages?: ChatMessage[]): string {
    const folder = this.getSaveFolder();
    const safeTitle = this.sanitizeFilename(title) || 'conversation';
    const dateStr = new Date(timestamp).toISOString().split('T')[0] ?? '';
    const yearMonth = dateStr.slice(0, 7); // YYYY-MM

    const orgMode = this.plugin.settings.conversationOrganization ?? 'flat';
    const validModes = ['flat', 'by-date', 'by-project'] as const;
    const validatedMode = validModes.includes(orgMode) ? orgMode : 'flat';

    if (validatedMode === 'by-date') {
      return `${folder}/${yearMonth}/${safeTitle}-${dateStr}-${timestamp}.md`;
    }

    if (validatedMode === 'by-project') {
      const projectDir = this.getProjectFolder(messages);
      return `${folder}/${projectDir}/${safeTitle}-${dateStr}-${timestamp}.md`;
    }

    return `${folder}/${safeTitle}-${dateStr}-${timestamp}.md`;
  }
  ```

- [ ] **Step 3: Update `saveConversation` call to `generateFilePath`**
  Modify `saveConversation` to pass `messages` to `generateFilePath`:
  ```ts
  const filePath = this.generateFilePath(conversationTitle, Date.now(), messages);
  ```

---

### Task 2: Dynamic File Moving on Update

**Files:**
- Modify: `src/VaultManager.ts`

**Interfaces:**
- Consumes: `generateFilePath` and Obsidian `app.fileManager.renameFile`.

- [ ] **Step 1: Implement dynamic file moving inside `updateConversation`**
  Update `updateConversation` to detect if the path changes, ensure parent folder exists, and rename/move the file:
  ```ts
  public async updateConversation(filePath: string, messages: ChatMessage[], title?: string, allowedTools: null | string[] = null): Promise<boolean> {
    let file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      console.warn(`[Hermes] updateConversation: file not found or not a TFile: ${filePath}`);
      return false;
    }

    try {
      const conversationTitle = title || 'Conversation';
      const content = this.messagesToMarkdown(messages, conversationTitle, allowedTools);

      const orgMode = this.plugin.settings.conversationOrganization ?? 'flat';
      if (orgMode === 'by-project') {
        const newPath = this.generateFilePath(conversationTitle, file.stat.ctime, messages);
        if (newPath !== file.path) {
          const folderPath = newPath.split('/').slice(0, -1).join('/');
          if (folderPath) {
            await this.ensureFolderExists(folderPath);
          }
          await this.plugin.app.fileManager.renameFile(file, newPath);
          const movedFile = this.vault.getAbstractFileByPath(newPath);
          if (movedFile instanceof TFile) {
            file = movedFile;
          }
        }
      }

      await this.vault.modify(file, content);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Hermes] Failed to update conversation:', error);
      new Notice(`Failed to update conversation: ${message}`);
      return false;
    }
  }
  ```

- [ ] **Step 2: Commit Task 1 and 2**
  Run: `git commit -am "feat: implement tag-based by-project conversation organization and renaming"`

---

### Task 3: Test Conversation Organization

**Files:**
- Modify: `src/__tests__/VaultManager.test.ts`

- [ ] **Step 1: Write unit tests for tag resolution and file move**
  Add these tests to `VaultManager.test.ts` under the main suite:
  ```ts
  describe('by-project organization', () => {
    it('should resolve folder by active note tags', async () => {
      const { TFile, TFolder } = await import('obsidian');
      const activeFile = new TFile('active.md');
      plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(activeFile);
      plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue({
        frontmatter: { tags: ['project/hermes'] }
      });
      plugin.settings.conversationOrganization = 'by-project';

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(new TFolder('hermes'));
      plugin.app.vault.create = vi.fn().mockResolvedValue({ path: 'hermes/project/hermes/chat.md' });

      const messages: ChatMessage[] = [{ id: '1', content: 'Hello', role: 'user', timestamp: Date.now() }];
      await vaultManager.saveConversation(messages, 'Test Title');

      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('hermes/project-hermes/'),
        expect.any(String)
      );
    });

    it('should fall back to messages tags if active note has no tags', async () => {
      const { TFile, TFolder } = await import('obsidian');
      plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
      plugin.settings.conversationOrganization = 'by-project';

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(new TFolder('hermes'));
      plugin.app.vault.create = vi.fn().mockResolvedValue({ path: 'hermes/writing/chat.md' });

      const messages: ChatMessage[] = [
        { id: '1', content: 'Hello #writing', role: 'user', timestamp: Date.now() }
      ];
      await vaultManager.saveConversation(messages, 'Test Title');

      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('hermes/writing/'),
        expect.any(String)
      );
    });

    it('should fall back to general if no tags are found', async () => {
      const { TFile, TFolder } = await import('obsidian');
      plugin.app.workspace.getActiveFile = vi.fn().mockReturnValue(null);
      plugin.settings.conversationOrganization = 'by-project';

      plugin.app.vault.getAbstractFileByPath = vi.fn().mockReturnValue(new TFolder('hermes'));
      plugin.app.vault.create = vi.fn().mockResolvedValue({ path: 'hermes/general/chat.md' });

      const messages: ChatMessage[] = [
        { id: '1', content: 'Hello', role: 'user', timestamp: Date.now() }
      ];
      await vaultManager.saveConversation(messages, 'Test Title');

      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        expect.stringContaining('hermes/general/'),
        expect.any(String)
      );
    });
  });
  ```

- [ ] **Step 2: Run tests and verify**
  Run: `pnpm test`
  Expected: PASS

---

### Task 4: Native Git Push and Admonition Slash Commands

**Files:**
- Modify: `src/CommunityPluginsManager.ts`
- Modify: `src/SlashCommands.ts`

- [ ] **Step 1: Add native git push helper in `CommunityPluginsManager.ts`**
  Add the following method:
  ```ts
  public runGitPush(): string {
    try {
      const adapter = this.plugin.app.vault.adapter as PathCapableAdapter;
      const basePath = adapter.getBasePath ? adapter.getBasePath() : "";
      if (!basePath) return "Unable to determine vault path for git execution.";
      const output = execSync("git push", {
        cwd: basePath,
        encoding: "utf-8"
      });
      return `### 🚀 Git Push\n\n\`\`\`text\n${output || "Success (no output)"}\n\`\`\``;
    } catch (e) {
      return `Git push failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  ```

- [ ] **Step 2: Add admonition insert helper in `CommunityPluginsManager.ts`**
  Add the following method:
  ```ts
  public insertAdmonition(type: string, title?: string): string {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return "No active note editor found. Open a note first.";
    }
    const editor = activeView.editor;
    const header = title ? ` [!${type}] ${title}` : ` [!${type}]`;
    const block = `> ${header}\n> \n`;
    editor.replaceSelection(block);
    return `Inserted **${type}** Admonition at cursor in **${activeView.file?.basename}**.`;
  }
  ```

- [ ] **Step 3: Update `SlashCommands.ts` git push execution**
  Update the `/git` command in `BUILT_IN_COMMANDS`:
  ```ts
      if (sub === "push") {
        return plugin.communityPluginsManager.runGitPush();
      }
  ```

- [ ] **Step 4: Update `SlashCommands.ts` admonition insert execution**
  Update the `/admonition` command in `BUILT_IN_COMMANDS`:
  ```ts
      if (sub === "insert") {
        if (!type)
          return "Please specify a type. Example: `/admonition insert note`";
        const title = parts.slice(1).join(" ").trim();
        return plugin.communityPluginsManager.insertAdmonition(type, title);
      }
  ```

---

### Task 5: Native Markdown Table Commands

**Files:**
- Modify: `src/CommunityPluginsManager.ts`
- Modify: `src/SlashCommands.ts`

- [ ] **Step 1: Add table generate and format helpers in `CommunityPluginsManager.ts`**
  Add the following methods:
  ```ts
  public generateTable(colsStr?: string, rowsStr?: string): string {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return "No active note editor found. Open a note first.";
    }
    const cols = parseInt(colsStr || "3", 10) || 3;
    const rows = parseInt(rowsStr || "2", 10) || 2;

    if (cols < 1 || rows < 1) {
      return "Columns and rows must be at least 1.";
    }

    const headerRow = "|" + Array(cols).fill(" Column ").join("|") + "|";
    const separatorRow = "|" + Array(cols).fill(" --- ").join("|") + "|";
    const dataRow = "|" + Array(cols).fill("   ").join("|") + "|";
    const dataRows = Array(rows).fill(dataRow).join("\n");

    const table = `${headerRow}\n${separatorRow}\n${dataRows}\n`;
    activeView.editor.replaceSelection(table);
    return `Generated a ${cols}x${rows} table at cursor in **${activeView.file?.basename}**.`;
  }

  public formatTable(): string {
    const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return "No active note editor found. Open a note first.";
    }

    const commands = (this.plugin.app as ObsidianAppWithCommands).commands;
    if (commands && commands.executeCommandById) {
      const executed = commands.executeCommandById("table-editor-obsidian:format-table");
      if (executed !== false) {
        return `Triggered Advanced Tables formatting in **${activeView.file?.basename}**.`;
      }
    }
    return "Failed to trigger Advanced Tables formatting. Make sure the plugin is enabled and your cursor is inside a table.";
  }
  ```

- [ ] **Step 2: Update `SlashCommands.ts` table execution**
  Update the `/table` command in `BUILT_IN_COMMANDS` to call the new methods:
  ```ts
      if (sub === "generate") {
        const subArgs = parts.slice(1).join(" ").trim().split(/\s+/);
        return plugin.communityPluginsManager.generateTable(subArgs[0], subArgs[1]);
      }
      if (sub === "format") {
        return plugin.communityPluginsManager.formatTable();
      }
  ```

---

### Task 6: Native Bases File Creation

**Files:**
- Modify: `src/BasesManager.ts`
- Modify: `src/SlashCommands.ts`

- [ ] **Step 1: Add `createBase` method to `BasesManager.ts`**
  Import `TFile` if not present, and implement:
  ```ts
  public async createBase(name: string): Promise<string> {
    const safeName = name.trim().replace(/\.base$/, "") || "new-base";
    const path = `${safeName}.base`;

    const config: BaseFile = {
      views: [
        {
          limit: 50,
          name: "All Notes",
          type: "table"
        }
      ]
    };

    const file = await this.saveBase(path, config);
    if (!file) {
      return `Failed to create Bases file: \`${path}\``;
    }

    const leaf = this.plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    return `Created and opened Bases file: \`${path}\``;
  }
  ```

- [ ] **Step 2: Update `SlashCommands.ts` bases create execution**
  Update the `/bases` command in `BUILT_IN_COMMANDS`:
  ```ts
      if (sub === "create") {
        const name = rest || "new-base";
        return plugin.basesManager.createBase(name);
      }
  ```

- [ ] **Step 3: Commit and run full build**
  Run: `pnpm build`
  Verify that TypeScript checks pass cleanly.
