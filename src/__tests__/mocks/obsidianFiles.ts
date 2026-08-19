// Test helpers for constructing Obsidian file objects.
//
// The runtime tests mock the `obsidian` module (via `vi.mock`), so `TFile`/
// `TFolder` accept a path argument there. But `tsconfig.test.json` type-checks
// against the REAL Obsidian types, whose constructors take no arguments. These
// helpers build real `TFile`/`TFolder` instances and then assign `path` so the
// result type-checks AND works with both the runtime mock and real types.

import { TFolder, TFile } from "obsidian";

export function makeTFile(path: string, extension?: string): TFile {
  const file = new TFile();
  file.path = path;
  if (extension) {
    file.extension = extension;
    const basename = path.split("/").pop() ?? "";
    file.basename = basename.replace(/\.\w+$/, "");
    file.name = basename;
  }
  return file;
}

export function makeTFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  return folder;
}
