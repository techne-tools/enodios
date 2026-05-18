// Mock Obsidian module for tests
export class Notice {
  constructor(message) {
    this.message = message;
  }
}

export class TFile {
  constructor(path) {
    this.extension = 'md';
    this.path = path || '';
    this.stat = { ctime: Date.now(), mtime: Date.now() };
  }
}

export class TFolder {
  constructor(path) {
    this.children = [];
    this.path = path || '';
  }
}

export class Vault {
  constructor() {
    this.getAbstractFileByPath = () => null;
    this.create = () => Promise.resolve(null);
    this.createFolder = () => Promise.resolve(null);
    this.modify = () => Promise.resolve(undefined);
    this.read = () => Promise.resolve('');
    this.trash = () => Promise.resolve(undefined);
  }
}

export class Workspace {
  constructor() {
    this.getActiveFile = () => null;
  }
}

export class App {
  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace();
    this.metadataCache = { getFileCache: () => null };
  }
}
