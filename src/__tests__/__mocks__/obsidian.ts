// Comprehensive Mock Obsidian module for tests.
// This mirrors the runtime mock resolved by vitest.config.ts (via the
// `obsidian` alias) AND provides enough of the type surface for
// tsconfig.test.json to type-check both the source files (which import from
// `obsidian`) and the test files. Keep this file's public shape in sync with
// the real Obsidian API so tests remain meaningful.

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function parseYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (match?.[1]) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

export function stringifyYaml(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
      );
    return entries.join("\n");
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class View extends Component {}

export class ItemView extends View {
  constructor(_leaf: unknown) {
    super();
  }
}

export class MarkdownView extends View {
  file: TFile | null = null;
  editor: MockEditor = new MockEditor();
}

export class Modal extends Component {
  open(): void {}
  close(): void {}
}

export class FuzzySuggestModal<T> extends Modal {
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent): void {}
}

// A minimal Editor with the methods used by the source.
export class MockEditor {
  getCursor(_which?: "from" | "to"): { line: number; ch: number } {
    return { line: 0, ch: 0 };
  }
  getLine(_line: number): string {
    return "";
  }
  getSelection(): string {
    return "";
  }
  lineCount(): number {
    return 1;
  }
  posToOffset(_pos: { line: number; ch: number }): number {
    return 0;
  }
  replaceSelection(_text: string): void {}
  setCursor(_pos: { line: number; ch: number }): void {}
  scrollIntoView(): void {}
}

export const MarkdownRenderer = {
  render(
    _app: App,
    _markdown: string,
    _el: HTMLElement,
    _sourcePath: string,
    _component: Component,
  ): Promise<void> {
    return Promise.resolve();
  },
};

// ---------------------------------------------------------------------------
// Vault / files
// ---------------------------------------------------------------------------

export class TFile {
  basename: string;
  extension: string;
  name: string;
  path: string;
  stat: { ctime: number; mtime: number; size: number };
  vault: Vault;

  constructor(path?: string) {
    this.path = path || "";
    const parts = this.path.split("/");
    this.name = parts.pop() ?? "";
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.extension = this.name.includes(".")
      ? (this.name.split(".").pop() ?? "")
      : "md";
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
    this.vault = new Vault();
  }
}

export class TFolder {
  children: TFile[];
  isFolder = true;
  name: string;
  path: string;
  vault: Vault;

  constructor(path?: string) {
    this.path = path || "";
    this.children = [];
    const parts = this.path.split("/");
    this.name = parts.pop() ?? "";
    this.vault = new Vault();
  }
}

export class FileSystemAdapter {
  getBasePath(): string {
    return "/mock/vault";
  }
}

export class Vault {
  adapter: FileSystemAdapter;

  constructor() {
    this.adapter = new FileSystemAdapter();
  }

  getAbstractFileByPath(_path: string): TFile | TFolder | null {
    return null;
  }
  getFiles(): TFile[] {
    return [];
  }
  getMarkdownFiles(): TFile[] {
    return [];
  }
  getRoot(): TFolder {
    return new TFolder("");
  }
  create(_path: string, _data?: string): Promise<TFile> {
    return Promise.resolve(new TFile(_path));
  }
  createBinary(_path: string, _data: ArrayBuffer): Promise<TFile> {
    return Promise.resolve(new TFile(_path));
  }
  createFolder(_path: string): Promise<TFolder> {
    return Promise.resolve(new TFolder(_path));
  }
  modify(_file: TFile, _data: string): Promise<void> {
    return Promise.resolve();
  }
  read(_file: TFile): Promise<string> {
    return Promise.resolve("");
  }
  cachedRead(_file: TFile): Promise<string> {
    return Promise.resolve("");
  }
  readBinary(_file: TFile): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
  trash(_file: TFile | TFolder, _system: boolean): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Workspace / leaves
// ---------------------------------------------------------------------------

export class WorkspaceLeaf {
  view: View = new View();
  openFile(_file: TFile): Promise<void> {
    return Promise.resolve();
  }
  setViewState(_state: unknown): Promise<void> {
    return Promise.resolve();
  }
  getViewType(): string {
    return "empty";
  }
}

export class EventRef {
  ref = "mock";
}

export class Workspace {
  activeLeaf: WorkspaceLeaf | null = null;

  getActiveFile(): TFile | null {
    return null;
  }
  getLeavesOfType(_type: string): WorkspaceLeaf[] {
    return [];
  }
  getMostRecentLeaf(): WorkspaceLeaf | null {
    return null;
  }
  getActiveViewOfType(_type: unknown): View | null {
    return null;
  }
  getLeaf(_split?: boolean): WorkspaceLeaf {
    return new WorkspaceLeaf();
  }
  getRightLeaf(_split?: boolean): WorkspaceLeaf | null {
    return new WorkspaceLeaf();
  }
  revealLeaf(_leaf: WorkspaceLeaf): Promise<void> {
    return Promise.resolve();
  }
  detachLeavesOfType(_type: string): void {}
  on(_name: string, _callback: (...args: unknown[]) => unknown): EventRef {
    return new EventRef();
  }
  offref(_ref: EventRef): void {}
}

// ---------------------------------------------------------------------------
// File manager
// ---------------------------------------------------------------------------

export class FileManager {
  processFrontMatter(
    _file: TFile,
    _fn: (data: Record<string, unknown>) => void,
  ): Promise<void> {
    return Promise.resolve();
  }
  renameFile(_file: TFile, _newPath: string): Promise<void> {
    return Promise.resolve();
  }
  trashFile(_file: TFile): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Metadata cache
// ---------------------------------------------------------------------------

export class MetadataCache {
  getFileCache(
    _file: TFile,
  ): {
    frontmatter?: Record<string, unknown>;
    tags?: { tag: string }[];
  } | null {
    return null;
  }
  getFirstLinkpathDest(_linkpath: string, _sourcePath: string): TFile | null {
    return null;
  }
  resolvedLinks: Record<string, unknown> = {};
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export class Plugins {
  plugins: Record<string, unknown> = {};
}

export class InternalPlugins {
  plugins: Record<string, unknown> = {};
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export class App {
  fileManager: FileManager;
  internalPlugins: InternalPlugins;
  metadataCache: MetadataCache;
  plugins: Plugins;
  vault: Vault;
  workspace: Workspace;

  constructor() {
    this.fileManager = new FileManager();
    this.internalPlugins = new InternalPlugins();
    this.metadataCache = new MetadataCache();
    this.plugins = new Plugins();
    this.vault = new Vault();
    this.workspace = new Workspace();
  }

  loadLocalStorage(_key: string): unknown {
    return null;
  }
  saveLocalStorage(_key: string, _value: unknown): void {}
}
