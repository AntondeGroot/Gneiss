import { Injectable } from "@angular/core";

import { parseNote } from "../../vault";
import type { ParsedNote } from "../../vault";

const MARKDOWN = ".md";

/**
 * Reads a real folder off the disk in a browser, via the File System Access API.
 *
 * Development aid, and **read-only**: it never requests write permission, so it
 * cannot modify the folder it is pointed at whatever the rest of the app does.
 *
 * It exists because Capacitor's Filesystem is backed by IndexedDB on the web, so
 * `ng serve` cannot otherwise open a real vault. On device, `VaultService` is the
 * real path — this is only for trying a vault against the parser quickly.
 *
 * TODO: remove once the app runs on a device against a synced folder.
 */
@Injectable({ providedIn: "root" })
export class FolderPickerService {
  get supported(): boolean {
    return "showDirectoryPicker" in globalThis;
  }

  /** Prompts for a folder, then parses every markdown file beneath it. */
  async pickAndRead(): Promise<ParsedNote[]> {
    const root = await pickDirectory();
    return this.readFolder(root, "");
  }

  private async readFolder(directory: DirectoryHandle, prefix: string): Promise<ParsedNote[]> {
    const notes: ParsedNote[] = [];

    for await (const [name, handle] of directory.entries()) {
      if (name.startsWith(".")) continue;
      notes.push(...(await this.readEntry(handle, joinPath(prefix, name), name)));
    }
    return notes;
  }

  private async readEntry(
    handle: DirectoryHandle | FileHandle,
    path: string,
    name: string,
  ): Promise<ParsedNote[]> {
    if (handle.kind === "directory") return this.readFolder(handle, path);
    if (!name.toLowerCase().endsWith(MARKDOWN)) return [];

    const file = await handle.getFile();
    return [parseNote(await file.text(), path)];
  }
}

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/* The File System Access API is not in the TypeScript DOM lib yet, so the small
   surface used here is declared rather than pulling in a whole ambient package. */

interface FileHandle {
  readonly kind: "file";
  getFile(): Promise<File>;
}

interface DirectoryHandle {
  readonly kind: "directory";
  entries(): AsyncIterableIterator<[string, DirectoryHandle | FileHandle]>;
}

async function pickDirectory(): Promise<DirectoryHandle> {
  const picker = (globalThis as unknown as Record<string, unknown>)["showDirectoryPicker"];
  if (typeof picker !== "function") {
    throw new Error("this browser cannot open a folder — try Chrome");
  }
  return (await (picker as () => Promise<DirectoryHandle>)()) satisfies DirectoryHandle;
}
