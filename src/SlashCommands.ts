import { TFile } from "obsidian";
import { isPluginEnabled } from "./utils/plugins.ts";

import type { Plugin } from "./Plugin.ts";

export interface SlashCommand {
  description: string;
  execute: (plugin: Plugin, args: string) => Promise<null | string>;
  name: string;
}

/**
 * Registry of built-in slash commands.
 * Commands are invoked with `/name [args]` in the chat input.
 *
 * ARCHITECTURAL ROLE:
 * Slash commands provide a lightweight, discoverable way for users to
 * trigger plugin actions without leaving the chat context. They are
 * parsed by the chat view (`HermesChatView`) and executed client-side.
 *
 * DESIGN DECISIONS:
 * - Commands return strings (displayed as assistant messages) or null
 *   (for silent operations like `/clear`).
 * - The `execute` function receives the full Plugin instance so commands
 *   can access vault, settings, and API clients directly.
 * - Commands are NOT sent to the Hermes agent — they are purely local UI
 *   shortcuts. This keeps latency low and avoids consuming API tokens.
 *
 * ADDING A NEW COMMAND:
 * 1. Add an entry to `BUILT_IN_COMMANDS`
 * 2. Implement `execute` — return a user-facing string or null
 * 3. The chat view will auto-register `/help` to list all commands
 */
const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    description: "Clear the current conversation",
    execute: async (_plugin) => {
      return null;
    },
    name: "clear"
  },
  {
    description: "Display a summary of the currently attached context items.",
    execute: async (plugin) => {
      const leaves = plugin.app.workspace.getLeavesOfType("hermes-chat-view");
      if (leaves.length === 0) {
        return "No active chat view found.";
      }
      const view = leaves[0]!.view as unknown as {
        activeContextItems: Array<Record<string, unknown>>;
      };
      const items = view.activeContextItems || [];
      if (items.length === 0) {
        return "Context is currently empty. Use the `@` button or type `[[` to add notes.";
      }

      let list = "### 📎 Active Chat Context\n\n";
      for (const item of items) {
        let details = "";
        if (item["type"] === "note") {
          const path = (item["id"] as string).replace(/^note-/, "");
          const file = plugin.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) {
            const content = await plugin.app.vault.read(file);
            const words = content.split(/\s+/).filter(Boolean).length;
            details = ` (${words} words, ${content.length} chars)`;
          }
        } else if (item["type"] === "selection") {
          details = ` (selection: ${(item["text"] as string).length} chars)`;
        } else if (item["type"] === "folder") {
          const path = (item["id"] as string).replace(/^folder-/, "");
          const files = plugin.app.vault
            .getFiles()
            .filter((f) => f.path.startsWith(path + "/"));
          details = ` (folder: ${files.length} files)`;
        } else if (item["type"] === "pdf") {
          details = " (PDF attachment)";
        } else if (item["type"] === "image") {
          details = " (image)";
        }

        list += `* **[${String(item["type"]).toUpperCase()}]** ${item["text"] as string}${details}\n`;
      }
      return list;
    },
    name: "context"
  },
  {
    description: "Show available slash commands",
    execute: async (_plugin) => {
      const commands = getSlashCommands();
      const list = commands
        .map((cmd) => `**/${cmd.name}** — ${cmd.description}`)
        .join("\n");
      return `Available commands:\n\n${list}`;
    },
    name: "help"
  },
  {
    description: "Switch persona / system prompt template",
    execute: async (plugin, args) => {
      const personas = plugin.settings.personaTemplates;
      const query = args.trim().toLowerCase();

      if (!query) {
        const list = personas
          .map(
            (p) =>
              `**${p.name}** (${p.id})${plugin.settings.activePersonaId === p.id ? " ← active" : ""}`
          )
          .join("\n");
        return `Available personas:\n\n${list}\n\nUse \`/persona <id>\` to switch.`;
      }

      const match = personas.find(
        (p) =>
          p.id.toLowerCase() === query || p.name.toLowerCase().includes(query)
      );

      if (!match) {
        return `Persona "${args}" not found. Use \`/persona\` to list available personas.`;
      }

      // @ts-expect-error - settings are mutable at runtime for persona switching
      plugin.settings.activePersonaId = match.id;
      await plugin.settingsManager.saveToFile();

      return `Switched to **${match.name}**. ${match.systemPrompt ? "System prompt updated." : "No system prompt set for this persona."}`;
    },
    name: "persona"
  },
  {
    description: "Search the vault and append results to context (Local RAG)",
    execute: async (plugin, args) => {
      if (!args.trim()) {
        return "Please provide a search query. Example: `/search project goals`";
      }

      if (isPluginEnabled(plugin.app, "omnisearch")) {
        return plugin.communityPluginsManager.searchOmnisearch(args.trim());
      }

      const query = args.toLowerCase();
      const terms = query.split(/\s+/).filter(Boolean);
      const files = plugin.app.vault.getMarkdownFiles();
      const matches: { excerpt: string; file: TFile; score: number }[] = [];

      for (const file of files) {
        const content = await plugin.app.vault.cachedRead(file);
        const lowerContent = content.toLowerCase();

        let score = 0;
        let firstMatchIdx = -1;

        for (const term of terms) {
          const idx = lowerContent.indexOf(term);
          if (idx !== -1) {
            score += 1;
            if (firstMatchIdx === -1 || idx < firstMatchIdx) {
              firstMatchIdx = idx;
            }
          }
        }

        if (score > 0) {
          const start = Math.max(0, firstMatchIdx - 60);
          const end = Math.min(content.length, firstMatchIdx + 200);
          let excerpt = content.slice(start, end).replace(/\n/g, " ");
          if (start > 0) {
            excerpt = `...${excerpt}`;
          }
          if (end < content.length) {
            excerpt += "...";
          }

          matches.push({ excerpt, file, score });
        }
      }

      if (matches.length === 0) {
        return `No vault notes found matching "${args}".`;
      }

      matches.sort((a, b) => b.score - a.score);
      const topMatches = matches.slice(0, 5);

      let result = `### 🔍 Vault Search Results for "${args}"\n\n`;
      result +=
        "*System note: The following excerpts were retrieved from the user's vault. Use them to answer the prompt. To read a full file, use the `read_file` tool on its path.*\n\n";

      for (const match of topMatches) {
        result += `**Path:** \`${match.file.path}\`\n> ${match.excerpt}\n\n`;
      }

      return result;
    },
    name: "search"
  },
  {
    description:
      "Manage citations & styles. Usage: /cite style [apa|mla|chicago|ieee] OR /cite search [query] OR /cite bib",
    execute: async (plugin, args) => {
      if (!plugin.settings.enableCitations) {
        return "Citations feature is disabled in settings.";
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const subArgs = parts.slice(1).join(" ");

      if (sub === "style") {
        const style = subArgs.toLowerCase().trim() as
          | "apa"
          | "mla"
          | "chicago"
          | "ieee";
        if (!["apa", "chicago", "ieee", "mla"].includes(style)) {
          return `Invalid style. Available: **apa**, **mla**, **chicago**, **ieee**`;
        }
        // @ts-expect-error - mutable setting
        plugin.settings.citationStyle = style;
        await plugin.settingsManager.saveToFile();
        return `Citation style updated to **${style.toUpperCase()}**.`;
      }

      if (sub === "search") {
        const query = subArgs;
        await plugin.citationManager.loadBibliography();
        const results = plugin.citationManager.search(query);
        if (results.length === 0) {
          return `No citations found for query "${query}".`;
        }
        let list = `### 🔍 Citation Search Results for "${query}"\n\n`;
        results.forEach((item) => {
          list += `* **[@${item.key}]** — *${item.title}* by ${item.author} (${item.year})\n`;
        });
        return list;
      }

      if (sub === "bib") {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile) {
          return "No active file to generate bibliography for.";
        }
        const content = await plugin.app.vault.read(activeFile);
        const style = plugin.settings.citationStyle;
        const bib = plugin.citationManager.generateBibliographyForContent(
          content,
          style
        );
        if (!bib) {
          return "No citations found in this file to generate references for. Ensure citations use `[@citation-key]` format.";
        }

        let newContent = content;
        const refHeaders = [
          /\n\n## References[\s\S]*$/i,
          /\n\n# References[\s\S]*$/i,
          /\n\n## Bibliography[\s\S]*$/i,
          /\n\n# Bibliography[\s\S]*$/i
        ];

        let replaced = false;
        for (const regex of refHeaders) {
          if (regex.test(content)) {
            newContent = content.replace(regex, bib);
            replaced = true;
            break;
          }
        }

        if (!replaced) {
          newContent = content + bib;
        }

        await plugin.app.vault.modify(activeFile, newContent);
        return `Generated bibliography and appended to **${activeFile.basename}**.`;
      }

      return "Usage:\n* `/cite style [apa|mla|chicago|ieee]`\n* `/cite search [query]`\n* `/cite bib`";
    },
    name: "cite"
  },
  {
    description:
      "Extract highlights/comments from a PDF file. Usage: /annotations <file-path>",
    execute: async (plugin, args) => {
      if (!plugin.settings.enableAnnotations) {
        return "PDF integrations are disabled in settings.";
      }
      const path = args.trim();
      if (!path) {
        return "Please specify a PDF file path. Example: `/annotations papers/my-paper.pdf`";
      }
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "pdf") {
        return `File not found or is not a PDF: \`${path}\`. Ensure it is a valid path in your vault.`;
      }

      try {
        const annots =
          await plugin.pdfAnnotationManager.extractAnnotations(file);
        const md = plugin.pdfAnnotationManager.formatAnnotationsMarkdown(
          annots,
          file.basename
        );
        return md;
      } catch (err) {
        return `Failed to extract annotations: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    name: "annotations"
  },
  {
    description:
      "Suggest or apply tags. Usage: /tags suggest OR /tags apply [tag1] [tag2] ...",
    execute: async (plugin, args) => {
      if (!plugin.settings.enableTags) {
        return "Tags suggestion feature is disabled in settings.";
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const tagsToApply = parts.slice(1);

      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        return "No active note found.";
      }

      if (sub === "suggest") {
        const content = await plugin.app.vault.read(activeFile);
        const title = activeFile.basename;
        const results = plugin.tagManager.suggestTagsForContent(content, title);
        if (results.length === 0) {
          return "No matching tags from your vault were found in this note.";
        }
        let list = `### 🏷️ Tag Suggestions for **${title}**\n\n`;
        results.forEach((r) => {
          list += `* **${r.tag}** (${Math.round(r.confidence * 100)}% confidence)\n`;
        });
        return list;
      }

      if (sub === "apply") {
        if (tagsToApply.length === 0) {
          return "Please specify one or more tags to apply. Example: `/tags apply academic study`";
        }
        await plugin.tagManager.applyTagsToNote(activeFile, tagsToApply);
        return `Applied tags: ${tagsToApply.map((t) => `**${t}**`).join(", ")} to **${activeFile.basename}**.`;
      }

      return "Usage:\n* `/tags suggest` — Suggest tags for the current note\n* `/tags apply <tag1> <tag2> ...` — Apply tags to the current note";
    },
    name: "tags"
  },
  {
    description:
      "List, load, or save conversation templates. Usage: /template list OR /template load [name] OR /template save [name]",
    execute: async (plugin, args) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const name = parts.slice(1).join(" ").trim();

      if (sub === "list") {
        const list = await plugin.templateManager.loadTemplates();
        let res = `### 📚 Conversation Templates\n\n`;
        list.forEach((t) => {
          res += `* **${t.icon} ${t.name}** — ${t.description}\n`;
        });
        return res;
      }

      if (sub === "load") {
        if (!name) {
          return "Please specify a template name. Example: `/template load Literature Review`";
        }
        const list = await plugin.templateManager.loadTemplates();
        const found = list.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        );
        if (!found) {
          return `Template "${name}" not found. Type \`/template list\` to see available templates.`;
        }

        const event = new CustomEvent("hermes-load-template", {
          detail: found.prompt
        });
        window.dispatchEvent(event);

        return `Loaded template **${found.name}** into chat input.`;
      }

      if (sub === "save") {
        if (!name) {
          return "Please specify a name for the template. Example: `/template save my-coach`";
        }

        const leaves = plugin.app.workspace.getLeavesOfType("hermes-chat-view");
        if (leaves.length === 0) {
          return "No active chat view found.";
        }
        const chatView = leaves[0]!.view as unknown as {
          activeMessages: Array<Record<string, unknown>>;
        };
        const messages = chatView.activeMessages || [];
        const userMsgs = messages.filter((m) => m["role"] === "user");
        if (userMsgs.length === 0) {
          return "No user prompt found in this conversation to save as template.";
        }
        const lastPrompt = userMsgs[userMsgs.length - 1]!["content"] as string;

        await plugin.templateManager.saveTemplate(name, lastPrompt);
        return `Template **${name}** saved successfully.`;
      }

      return "Usage:\n* `/template list` — List all templates\n* `/template load <name>` — Load a template prompt\n* `/template save <name>` — Save the last user prompt as a template";
    },
    name: "template"
  },
  {
    description:
      "Extract PDF page text or metadata. Usage: /pdf page [path] [page] OR /pdf metadata [path]",
    execute: async (plugin, args) => {
      if (!plugin.settings.enableAnnotations) {
        return "PDF integrations are disabled in settings.";
      }
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase();
      const path = parts[1];
      const pageStr = parts[2];

      if (!sub || !path) {
        return "Usage:\n* `/pdf page <pdf-path> <page-number>`\n* `/pdf metadata <pdf-path>`";
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "pdf") {
        return `File not found or is not a PDF: \`${path}\`.`;
      }

      if (sub === "page") {
        const pageNum = parseInt(pageStr || "", 10);
        if (isNaN(pageNum) || pageNum < 1) {
          return "Please specify a valid page number. Example: `/pdf page papers/my-paper.pdf 2`";
        }
        try {
          const text = await plugin.pdfAnnotationManager.extractPageText(
            file,
            pageNum
          );
          return `### 📄 Extracted Text from ${file.basename} (Page ${pageNum})\n\n${text}`;
        } catch (err) {
          return `Failed to extract page text: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      if (sub === "metadata") {
        try {
          const info = await plugin.pdfAnnotationManager.extractMetadata(file);
          let res = `### 📋 Metadata for ${file.basename}\n\n`;
          Object.entries(info).forEach(([k, v]) => {
            res += `* **${k}:** ${v}\n`;
          });
          return res;
        } catch (err) {
          return `Failed to extract metadata: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      return "Usage:\n* `/pdf page <pdf-path> <page-number>`\n* `/pdf metadata <pdf-path>`";
    },
    name: "pdf"
  },
  {
    description:
      "Show document outline, backlinks, or navigate to a heading. Usage: /outline [backlinks | go <heading>]",
    execute: async (plugin, args) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile) {
        return "No active note found.";
      }

      const parts = args.trim().split(/\s+(.*)/, 2);
      const cmd = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      if (cmd === "backlinks") {
        const backlinks = plugin.outlineManager.getBacklinks(activeFile);
        if (backlinks.length === 0) {
          return `No notes link to **${activeFile.basename}**.`;
        }
        let result = `### 🔗 Backlinks for **${activeFile.basename}**\n\n`;
        for (const b of backlinks) {
          result += `* [[${b.sourcePath}]] — ${b.linkCount} link${b.linkCount > 1 ? "s" : ""}\n`;
        }
        return result;
      }

      if (cmd === "go") {
        if (!rest) {
          return "Please specify a heading. Example: `/outline go Introduction`";
        }
        const found = await plugin.outlineManager.navigateToHeading(
          activeFile,
          rest
        );
        return found
          ? `Navigated to heading **${rest}** in ${activeFile.basename}.`
          : `Heading "${rest}" not found in ${activeFile.basename}.`;
      }

      // Default: show heading outline
      const outline = plugin.outlineManager.getOutline(activeFile);
      if (outline.length === 0) {
        return `**${activeFile.basename}** has no headings.`;
      }
      let result = `### 📋 Outline of **${activeFile.basename}**\n\n`;
      for (const h of outline) {
        const indent = "  ".repeat(h.level - 1);
        result += `${indent}${"#".repeat(h.level)} ${h.text}\n`;
      }
      return result;
    },
    name: "outline"
  },
  {
    description:
      "Compose notes: split, merge, or extract. Usage: /compose split <heading> | /compose merge <p1> <p2>... -> <dest>",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "note-composer")) {
        return "Note Composer plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      const activeFile = plugin.app.workspace.getActiveFile();

      if (sub === "split") {
        if (!rest) {
          return "Please specify a heading to split on. Example: `/compose split Conclusion`";
        }
        if (!activeFile) {
          return "No active note to split.";
        }
        const result = await plugin.noteComposerManager.splitNoteAtHeading(
          activeFile,
          rest
        );
        if (!result) {
          return `Failed to split note at heading "${rest}".`;
        }
        return `Split **${activeFile.basename}** at heading **${rest}**.\nCreated: [[${result.created.path}]]`;
      }

      if (sub === "merge") {
        // Format: path1 path2 ... -> destination
        const arrowIdx = rest.indexOf("->");
        if (arrowIdx === -1) {
          return "Usage: `/compose merge <path1> <path2> ... -> <destination>`";
        }
        const sourcePaths = rest
          .slice(0, arrowIdx)
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const destPath = rest.slice(arrowIdx + 2).trim();
        if (!destPath) {
          return "Please specify a destination path.";
        }
        const sources = sourcePaths
          .map((p) => plugin.app.vault.getAbstractFileByPath(p))
          .filter((f): f is TFile => f instanceof TFile);
        if (sources.length === 0) {
          return "No valid source files found. Check the paths.";
        }
        const merged = await plugin.noteComposerManager.mergeNotes(
          sources,
          destPath
        );
        if (!merged) {
          return `Merge failed. Ensure destination "${destPath}" does not already exist.`;
        }
        return `Merged ${sources.length} notes into [[${merged.path}]].`;
      }

      if (sub === "extract") {
        return 'To extract a selection, use the command palette: "Hermes: Extract selection to new note" (requires text selected in the editor).';
      }

      return "Usage:\n* `/compose split <heading>` — Split active note at heading\n* `/compose merge <path1> <path2> ... -> <destination>` — Merge notes\n* `/compose extract` — See command palette for selection extraction";
    },
    name: "compose"
  },
  {
    description:
      "Work with Obsidian Bases (.base) files. Usage: /bases list | /bases read <path> | /bases create <name>",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "bases")) {
        return "Bases plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      if (sub === "list" || !sub) {
        const bases = plugin.basesManager.listBases();
        if (bases.length === 0) {
          return "No `.base` files found in your vault.";
        }
        let result = `### 🗃️ Bases in Vault (${bases.length})\n\n`;
        for (const b of bases) {
          result += `* \`${b.path}\`\n`;
        }
        return result;
      }

      if (sub === "read") {
        const path = rest;
        if (!path) {
          return "Please specify a .base file path. Example: `/bases read notes.base`";
        }
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension !== "base") {
          return `File not found or not a .base file: \`${path}\``;
        }
        const base = await plugin.basesManager.parseBase(file);
        if (!base) {
          return `Failed to parse \`${path}\`.`;
        }
        return plugin.basesManager.formatBaseForContext(base, file);
      }

      if (sub === "create") {
        const name = rest || "new-base";
        return (
          `To create a Bases file named **${name}.base**, ask Hermes:\n\n` +
          `> Create a .base file at \`${name}.base\` with a table view showing all notes tagged #project, ordered by file name.`
        );
      }

      return "Usage:\n* `/bases list` — List all .base files\n* `/bases read <path>` — Read a base file into context\n* `/bases create <name>` — Prompt Hermes to generate a base file";
    },
    name: "bases"
  },
  {
    description:
      "Work with Canvas files. Usage: /canvas [list | read [path] | add-node <type> <label>]",
    execute: async (plugin, args) => {
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      if (!sub || sub === "read") {
        // Read active or specified canvas — now with structured CanvasManager output
        const pathArg = sub === "read" ? rest : "";
        const targetFile = pathArg
          ? (plugin.app.vault.getAbstractFileByPath(pathArg) as TFile | null)
          : plugin.app.workspace.getActiveFile();

        if (!targetFile || targetFile.extension !== "canvas") {
          return "No active Canvas file found. Open a .canvas file or specify a path: `/canvas read <path>`";
        }
        const canvas = await plugin.canvasManager.parseCanvas(targetFile);
        if (!canvas) {
          return `Failed to parse canvas: \`${targetFile.path}\``;
        }
        return plugin.canvasManager.formatCanvasForContext(canvas, targetFile);
      }

      if (sub === "list") {
        const canvases = plugin.canvasManager.listCanvases();
        if (canvases.length === 0) {
          return "No `.canvas` files found in your vault.";
        }
        let result = `### 🖼️ Canvas Files (${canvases.length})\n\n`;
        for (const c of canvases) {
          result += `* \`${c.path}\`\n`;
        }
        return result;
      }

      if (sub === "add-node") {
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "canvas") {
          return "No active Canvas file. Open a .canvas file first.";
        }
        const argParts = rest.trim().split(/\s+(.*)/, 2);
        const nodeType = (argParts[0] ?? "text") as
          | "file"
          | "group"
          | "link"
          | "text";
        const label = argParts[1] ?? "New Node";
        const node = await plugin.canvasManager.addNodeToCanvas(activeFile, {
          height: 200,
          text: label,
          type: nodeType,
          width: 400
        });
        if (!node) {
          return "Failed to add node to canvas.";
        }
        return `Added ${nodeType} node "${label}" to **${activeFile.basename}** (id: ${node.id}).`;
      }

      return "Usage:\n* `/canvas` or `/canvas read [path]` — Read canvas into context\n* `/canvas list` — List all canvas files\n* `/canvas add-node <type> <label>` — Add a node to the active canvas";
    },
    name: "canvas"
  },
  {
    description:
      "Work with Obsidian Slides presentations. Usage: /slides [read | generate [title] | present]",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "slides")) {
        return "Slides core plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      const activeFile = plugin.app.workspace.getActiveFile();

      if (sub === "read" || !sub) {
        if (!activeFile) {
          return "No active note found.";
        }
        const slides = await plugin.slidesManager.parseSlides(activeFile);
        if (slides.length === 0) {
          return `**${activeFile.basename}** has no slides (no \`---\` separators found).`;
        }
        return plugin.slidesManager.formatSlidesForContext(slides, activeFile);
      }

      if (sub === "generate") {
        const title = rest || (activeFile?.basename ?? "Presentation");
        const contextNote = activeFile
          ? `\n\nContext note: **${activeFile.path}**`
          : "";
        return (
          `To generate a Slides presentation titled **"${title}"**, ask Hermes in the chat:\n\n` +
          `> Generate a Slides presentation titled "${title}". ` +
          `Use \`---\` to separate slides, \`# ${title}\` for the title slide, ` +
          `and \`##\` for section headings. Save it as \`${title.toLowerCase().replace(/\s+/g, "-")}.md\`.` +
          contextNote
        );
      }

      if (sub === "present") {
        if (!activeFile) {
          return "No active note to present.";
        }
        await plugin.slidesManager.openPresentationMode(activeFile);
        return `Launching **${activeFile.basename}** in Slides presentation mode...`;
      }

      return "Usage:\n* `/slides read` — Summarize the active slides note\n* `/slides generate [title]` — Prompt to generate a presentation\n* `/slides present` — Launch Slides presentation mode";
    },
    name: "slides"
  },
  {
    description:
      "Work with Obsidian note templates. Usage: /note-template [list | insert <name> | read <name>]",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "templates")) {
        return "Note Templates core plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const rest = (parts[1] ?? "").trim();

      if (sub === "list" || !sub) {
        const templates = plugin.noteTemplateManager.listNoteTemplates();
        return plugin.noteTemplateManager.formatTemplatesListForContext(
          templates
        );
      }

      if (sub === "read") {
        if (!rest) {
          return "Please specify a template name. Example: `/note-template read Meeting Notes`";
        }
        const template = plugin.noteTemplateManager.findTemplate(rest);
        if (!template) {
          return `Template "${rest}" not found. Use \`/note-template list\` to see available templates.`;
        }
        const content = await plugin.noteTemplateManager.readTemplate(template);
        return `### 📄 Template: ${template.basename}\n\n\`\`\`markdown\n${content}\n\`\`\``;
      }

      if (sub === "insert") {
        if (!rest) {
          return "Please specify a template name. Example: `/note-template insert Meeting Notes`";
        }
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile) {
          return "No active note to insert the template into.";
        }
        const template = plugin.noteTemplateManager.findTemplate(rest);
        if (!template) {
          return `Template "${rest}" not found. Use \`/note-template list\` to see available templates.`;
        }
        await plugin.noteTemplateManager.insertTemplate(template, activeFile);
        return `Template **${template.basename}** inserted into **${activeFile.basename}**.`;
      }

      return "Usage:\n* `/note-template list` — List all note templates\n* `/note-template read <name>` — Read a template into context\n* `/note-template insert <name>` — Insert a template into the active note";
    },
    name: "note-template"
  },
  {
    description: "Execute a Dataview query. Usage: /dataview <query>",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "dataview")) {
        return "Dataview plugin is not enabled.";
      }
      const query = args.trim();
      if (!query) {
        return 'Please provide a Dataview query. Example: `/dataview TABLE file.ctime FROM "Folder"`';
      }
      const activeFile = plugin.app.workspace.getActiveFile();
      const sourcePath = activeFile ? activeFile.path : "";
      return plugin.communityPluginsManager.executeDataviewQuery(
        query,
        sourcePath
      );
    },
    name: "dataview"
  },
  {
    description:
      "Templater actions. Usage: /templater [insert <name> | scripts | generate]",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "templater-obsidian")) {
        return "Templater plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const templateName = (parts[1] ?? "").trim();

      if (sub === "insert") {
        if (!templateName)
          return "Please specify a template name. Example: `/templater insert daily`";
        const activeFile = plugin.app.workspace.getActiveFile();
        if (!activeFile) return "No active note to insert the template into.";
        return plugin.communityPluginsManager.insertTemplaterTemplate(
          templateName,
          activeFile
        );
      }
      if (sub === "scripts") {
        return plugin.communityPluginsManager.getTemplaterUserScripts();
      }
      if (sub === "generate") {
        return `To generate a new Templater script or template, ask Hermes:\n\n> Write a Templater template to ...`;
      }
      return "Usage:\n* `/templater insert <name>`\n* `/templater scripts`\n* `/templater generate`";
    },
    name: "templater"
  },
  {
    description:
      "Read text from an Excalidraw drawing. Usage: /excalidraw read <path>",
    execute: async (plugin, args) => {
      if (!isPluginEnabled(plugin.app, "obsidian-excalidraw-plugin")) {
        return "Excalidraw plugin is not enabled.";
      }
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const path = (parts[1] ?? "").trim();

      if (sub === "read") {
        if (!path)
          return "Please specify a path. Example: `/excalidraw read drawings/map.md`";
        return plugin.communityPluginsManager.readExcalidraw(path);
      }
      return "Usage: `/excalidraw read <path>`";
    },
    name: "excalidraw"
  },
  {
    description:
      "Forge metadata management. Usage: /forge [validate | patch <desc>]",
    execute: async (plugin, args) => {
      // Assuming Forge doesn't strictly have to be enabled to generate patches, but we check anyway if needed.
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const desc = (parts[1] ?? "").trim();

      if (sub === "validate") {
        return plugin.communityPluginsManager.getForgeSchemasContext();
      }
      if (sub === "patch") {
        if (!desc)
          return "Please describe the patch. Example: `/forge patch rename tag from #wip to #active`";
        return plugin.communityPluginsManager.generateForgePatchPrompt(desc);
      }
      return "Usage:\n* `/forge validate` — Read Forge schemas into context\n* `/forge patch <description>` — Ask Hermes to generate a Forge patch";
    },
    name: "forge"
  },
  {
    description:
      "Analyze plugin load times for Lazy Loader. Usage: /lazyloader analyze",
    execute: async (plugin) => {
      return plugin.communityPluginsManager.getLazyLoaderSuggestions();
    },
    name: "lazyloader"
  },
  {
    description:
      "Git operations. Usage: /git [status | commit <message> | push]",
    execute: async (plugin, args) => {
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const message = (parts[1] ?? "").trim();

      if (sub === "status") {
        return plugin.communityPluginsManager.getGitStatus();
      }
      if (sub === "commit") {
        return plugin.communityPluginsManager.getGitCommitPrompt(message);
      }
      if (sub === "push") {
        return "To push changes, ask Hermes:\n\n> Please run `git push` to upload my latest commits.";
      }
      return "Usage:\n* `/git status` — View git status\n* `/git commit [message]` — Generate a commit message based on diff\n* `/git push` — Instruct Hermes to push changes";
    },
    name: "git"
  },
  {
    description: "Run the Obsidian Linter on the active file. Usage: /lint",
    execute: async (plugin) => {
      if (!isPluginEnabled(plugin.app, "obsidian-linter")) {
        return "Linter plugin is not enabled.";
      }
      return plugin.communityPluginsManager.lintActiveFile();
    },
    name: "lint"
  },
  {
    description: "Insert an Admonition block. Usage: /admonition insert <type>",
    execute: async (_plugin, args) => {
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();
      const type = (parts[1] ?? "").trim();

      if (sub === "insert") {
        if (!type)
          return "Please specify a type. Example: `/admonition insert ad-note`";
        return `To insert an Admonition, ask Hermes:\n\n> Please format the following thought as an \`${type}\` Admonition block: [your text]`;
      }
      return "Usage: `/admonition insert <type>`";
    },
    name: "admonition"
  },
  {
    description: "Advanced Tables tools. Usage: /table [generate | format]",
    execute: async (_plugin, args) => {
      const parts = args.trim().split(/\s+(.*)/, 2);
      const sub = (parts[0] ?? "").toLowerCase();

      if (sub === "generate") {
        return "Ask Hermes:\n\n> Generate a strict Markdown table. Ensure all columns are perfectly aligned so Advanced Tables can parse it.";
      }
      if (sub === "format") {
        return "Ask Hermes:\n\n> Reformat the table in the active note to be perfectly aligned for Advanced Tables.";
      }
      return "Usage:\n* `/table generate`\n* `/table format`";
    },
    name: "table"
  },
  {
    description: "Format the active file with Prettier. Usage: /prettier",
    execute: async (plugin) => {
      if (!isPluginEnabled(plugin.app, "obsidian-prettier")) {
        return "Prettier plugin is not enabled.";
      }
      return plugin.communityPluginsManager.formatWithPrettier();
    },
    name: "prettier"
  },
  {
    description: "Make.md tools. Usage: /makemd",
    execute: async () => {
      return "To integrate with make.md, ask Hermes:\n\n> Please structure this content using make.md Contexts or Spaces format.";
    },
    name: "makemd"
  }
];

let customCommands: SlashCommand[] = [];
let cachedToolCommands: SlashCommand[] = [];

/**
 * Clear all custom and cached commands. Call on plugin unload.
 */
export function clearAllCommands(): void {
  customCommands = [];
  cachedToolCommands = [];
}

/**
 * Clear the cached tool commands (e.g. after settings change).
 */
export function clearToolCache(): void {
  cachedToolCommands = [];
}

/**
 * Get all available slash commands (built-in + custom + cached tool commands).
 * Note: Tool commands from the API are fetched separately via getToolSlashCommands().
 * Built-in commands take precedence; duplicates by name are removed.
 */
export function getSlashCommands(): SlashCommand[] {
  const all = [...BUILT_IN_COMMANDS, ...customCommands, ...cachedToolCommands];
  const seen = new Set<string>();
  return all.filter((cmd) => {
    if (seen.has(cmd.name)) {
      return false;
    }
    seen.add(cmd.name);
    return true;
  });
}

/**
 * Fetch available tools from Hermes via ACP.
 * Commands now arrive via ACP push (available_commands_update), so this is a no-op.
 * Kept for API compatibility.
 */
export async function getToolSlashCommands(
  _plugin: Plugin
): Promise<SlashCommand[]> {
  return cachedToolCommands;
}

/**
 * Parse a message to detect if it starts with a slash command.
 * Checks built-in, custom, and cached tool commands.
 * Returns the command and remaining args, or null if not a slash command.
 */
export function parseSlashCommand(
  message: string
): { args: string; command: SlashCommand } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+(.*)/);
  const name = parts[0] ?? "";
  const args = parts[1] ?? "";

  const allCommands = [
    ...BUILT_IN_COMMANDS,
    ...customCommands,
    ...cachedToolCommands
  ];
  const command = allCommands.find((cmd) => cmd.name === name);
  if (!command) {
    return null;
  }

  return { args, command };
}

/**
 * Register a custom slash command at runtime.
 */
export function registerSlashCommand(command: SlashCommand): void {
  customCommands.push(command);
}

/**
 * Set the cached tool commands from ACP available_commands_update.
 */
export function setCachedToolCommands(commands: SlashCommand[]): void {
  cachedToolCommands = commands;
}

/**
 * Unregister a custom slash command by name.
 */
export function unregisterSlashCommand(name: string): void {
  customCommands = customCommands.filter((cmd) => cmd.name !== name);
}
