// Mock Obsidian module for tests
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export class TFile {
  extension: string;
  path: string;
  stat: { ctime: number; mtime: number };
  constructor(path: string) {
    this.extension = 'md';
    this.path = path || '';
    this.stat = { ctime: Date.now(), mtime: Date.now() };
  }
}

export class TFolder {
  children: any[];
  path: string;
  constructor(path: string) {
    this.children = [];
    this.path = path || '';
  }
}

export class Vault {
  getAbstractFileByPath() { return null; }
  create() { return Promise.resolve(null); }
  createFolder() { return Promise.resolve(null); }
  modify() { return Promise.resolve(undefined); }
  read() { return Promise.resolve(''); }
  trash() { return Promise.resolve(undefined); }
}

export class Workspace {
  getActiveFile() { return null; }
}

export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: { getFileCache: () => null };

  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace();
    this.metadataCache = { getFileCache: () => null };
  }
}

export class Component {
  load() {}
  unload() {}
}

export class View extends Component {}

export class ItemView extends View {
  constructor(leaf: any) {
    super();
  }
}

export class MarkdownView extends View {
  file: any = null;
}
