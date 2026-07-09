import { TFile } from 'obsidian';
import { execSync } from 'child_process';
import type { Plugin } from './Plugin.ts';

export class CommunityPluginsManager {
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  // --- Dataview ---
  public async executeDataviewQuery(query: string, sourcePath: string): Promise<string> {
    const dv = (window as any).DataviewAPI;
    if (!dv) {
      return 'DataviewAPI is not available on the window object.';
    }
    
    try {
      const result = await dv.queryMarkdown(query, sourcePath);
      if (result.successful) {
        return result.value || 'No results.';
      } else {
        return `Dataview query error: ${result.error}`;
      }
    } catch (err) {
      return `Dataview execution failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Templater ---
  public async insertTemplaterTemplate(templateName: string, activeFile: TFile): Promise<string> {
    const templaterPlugin = (this.plugin.app as any).plugins.plugins['templater-obsidian'];
    if (!templaterPlugin || !templaterPlugin.templater) {
      return 'Templater API is not accessible.';
    }
    
    try {
      const templatesFolder = templaterPlugin.settings?.templates_folder || '';
      const templatePath = templatesFolder ? `${templatesFolder}/${templateName}.md` : `${templateName}.md`;
      const templateFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
      
      if (!(templateFile instanceof TFile)) {
        return `Template file not found at path: ${templatePath}`;
      }
      
      const content = await this.plugin.app.vault.read(templateFile);
      const parsedContent = await templaterPlugin.templater.parse_template({ target_file: activeFile, run_mode: 4 }, content);
      
      const currentContent = await this.plugin.app.vault.read(activeFile);
      await this.plugin.app.vault.modify(activeFile, currentContent + '\n' + parsedContent);
      
      return `Inserted template **${templateName}** into **${activeFile.basename}**.`;
    } catch (err) {
      return `Templater execution failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Omnisearch ---
  public async searchOmnisearch(query: string): Promise<string> {
    const omnisearch = (window as any).omnisearch;
    if (!omnisearch) {
      return 'Omnisearch API is not available.';
    }
    
    try {
      const results = await omnisearch.search(query);
      if (!results || results.length === 0) {
        return `No Omnisearch results found for "${query}".`;
      }
      
      let list = `### 🔍 Omnisearch Results for "${query}"\n\n`;
      const topResults = results.slice(0, 5);
      for (const res of topResults) {
        list += `* **[[${res.path}]]** (Score: ${Math.round(res.score)})\n`;
        if (res.excerpt) {
          list += `  > ${res.excerpt}\n`;
        }
      }
      return list;
    } catch (err) {
      return `Omnisearch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Excalidraw ---
  public async readExcalidraw(path: string): Promise<string> {
    const excalidrawPlugin = (this.plugin.app as any).plugins.plugins['obsidian-excalidraw-plugin'];
    if (!excalidrawPlugin) {
      return 'Excalidraw plugin is not accessible.';
    }
    
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return `File not found: ${path}`;
    }
    
    try {
      const content = await this.plugin.app.vault.read(file);
      const match = content.match(/```json\n([\s\S]*?)\n```/);
      if (!match || !match[1]) {
        return 'Could not find Excalidraw JSON data in this file. Note: Excalidraw files must be parsed from their internal JSON state.';
      }
      
      const excalidrawData = JSON.parse(match[1]);
      const elements = excalidrawData.elements || [];
      const textElements = elements.filter((e: any) => e.type === 'text' && e.text);
      
      if (textElements.length === 0) {
        return `No text elements found in Excalidraw drawing **${file.basename}**.`;
      }
      
      let list = `### 🎨 Excalidraw Text from **${file.basename}**\n\n`;
      for (const el of textElements) {
        list += `- ${el.text}\n`;
      }
      
      return list;
    } catch (err) {
      return `Failed to read Excalidraw drawing: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // --- Templater (Deep) ---
  public async getTemplaterUserScripts(): Promise<string> {
    const templaterPlugin = (this.plugin.app as any).plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) return 'Templater plugin is not accessible.';
    
    const scriptsFolder = templaterPlugin.settings?.user_scripts_folder;
    if (!scriptsFolder) return 'No user scripts folder configured in Templater settings.';
    
    const files = this.plugin.app.vault.getFiles().filter(f => f.path.startsWith(scriptsFolder) && f.extension === 'js');
    if (files.length === 0) return `No user scripts found in ${scriptsFolder}.`;
    
    let list = `### 📜 Templater User Scripts (${scriptsFolder})\n\n`;
    for (const file of files) {
      list += `* **\`tp.user.${file.basename}()\`**\n`;
    }
    return list;
  }

  // --- Forge ---
  public generateForgePatchPrompt(description: string): string {
    return `To generate a Forge patch, ask Hermes:\n\n> Create a Forge patch to ${description}. The patch should be formatted as a valid Forge JSON/YAML patch object to update metadata across multiple notes.`;
  }
  
  public getForgeSchemasContext(): string {
    const files = this.plugin.app.vault.getFiles().filter(f => f.path.includes('System/Registry') && f.extension === 'md');
    return `### 🛠️ Forge Registry\n\nFound ${files.length} schema files in \`System/Registry\`. Tell Hermes to use the \`read_file\` tool on them to understand your vault's structural rules.`;
  }

  // --- Lazy Loader ---
  public getLazyLoaderSuggestions(): string {
    const plugins = (this.plugin.app as any).plugins?.plugins;
    if (!plugins) return 'Unable to read active plugins.';
    
    // Some plugins measure load times on app.plugins.plugins, but if not we can use heuristics
    const heavyPlugins = ['dataview', 'obsidian-excalidraw-plugin', 'templater-obsidian', 'omnisearch', 'obsidian-git', 'obsidian-linter', 'table-editor-obsidian'];
    const activeHeavy = Object.keys(plugins).filter(id => heavyPlugins.includes(id));
    
    if (activeHeavy.length === 0) {
      return 'No particularly heavy plugins were detected that need lazy loading.';
    }
    
    let result = `### 🐢 Lazy Loader Suggestions\n\n`;
    result += `The following active plugins are known to be resource-intensive during startup. Consider using Lazy Loader to delay their initialization:\n\n`;
    for (const p of activeHeavy) {
      result += `* **${p}**\n`;
    }
    result += `\nTo lazy load them, open the Lazy Loader settings and add these IDs to the delayed plugins list.`;
    
    return result;
  }

  // --- Obsidian Git ---
  public getGitStatus(): string {
    try {
      const adapter = this.plugin.app.vault.adapter as any;
      const basePath = adapter.getBasePath ? adapter.getBasePath() : '';
      if (!basePath) return 'Unable to determine vault path for git execution.';
      const status = execSync('git status -s', { cwd: basePath, encoding: 'utf-8' });
      return status ? `### 📦 Git Status\n\n\`\`\`text\n${status}\n\`\`\`` : 'Git working tree is clean.';
    } catch (e) {
      return `Git status failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  public getGitCommitPrompt(message?: string): string {
    try {
      const adapter = this.plugin.app.vault.adapter as any;
      const basePath = adapter.getBasePath ? adapter.getBasePath() : '';
      if (!basePath) return 'Unable to determine vault path for git execution.';
      
      const diff = execSync('git diff', { cwd: basePath, encoding: 'utf-8' });
      const cachedDiff = execSync('git diff --cached', { cwd: basePath, encoding: 'utf-8' });
      const fullDiff = (cachedDiff + '\n' + diff).trim();
      
      if (!fullDiff) return 'No changes detected. The working tree is clean.';
      
      // Limit diff size to avoid blowing up context
      const truncatedDiff = fullDiff.length > 3000 ? fullDiff.substring(0, 3000) + '\n... (diff truncated)' : fullDiff;
      
      let prompt = `Please review the following git diff and generate a concise commit message.\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;
      if (message) {
        prompt += `\n\nUser suggested note: "${message}"`;
      }
      return prompt;
    } catch (e) {
      return `Git diff failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // --- Linter ---
  public lintActiveFile(): string {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) return 'No active file to lint.';
    
    const commands = (this.plugin.app as any).commands;
    if (commands && commands.executeCommandById) {
      commands.executeCommandById('obsidian-linter:lint-file');
      return `Triggered Linter on **${activeFile.basename}**.`;
    }
    return 'Unable to execute Obsidian commands programmatically.';
  }

  // --- Prettier ---
  public formatWithPrettier(): string {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) return 'No active file to format.';
    
    const commands = (this.plugin.app as any).commands;
    if (commands && commands.executeCommandById) {
      // Common command IDs for obsidian-prettier
      commands.executeCommandById('obsidian-prettier:format');
      return `Triggered Prettier formatting on **${activeFile.basename}**.`;
    }
    return 'Unable to execute Obsidian commands programmatically.';
  }
}
