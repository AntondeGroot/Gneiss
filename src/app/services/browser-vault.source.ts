import { Injectable } from "@angular/core";

import { DEFAULT_CONFIG, formatConfig, parseConfig, parseNote, withReviewState } from "../../vault";
import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";
import type { VaultSource } from "./vault-source";

const MARKDOWN = ".md";
const CONFIG_DIR = ".gneiss";
const CONFIG_FILE = "config.md";

/**
 * The vault as a folder the user picks in a browser, via the File System Access
 * API. This is what makes a hosted build usable on a laptop.
 *
 * Chromium only — Safari and Firefox do not implement the API, and there is no
 * polyfill for real filesystem access. `isAvailable()` is the guard.
 *
 * Nothing is uploaded: the handle stays in the page and the vault never leaves
 * the machine.
 */
@Injectable({ providedIn: "root" })
export class BrowserVaultSource implements VaultSource {
  private root: DirectoryHandle | null = null;
  private writable = false;

  readonly label = "Picked folder";

  isAvailable(): boolean {
    return "showDirectoryPicker" in globalThis;
  }

  /** False when the user granted read but declined write. */
  canWrite(): boolean {
    return this.writable;
  }

  async open(): Promise<void> {
    this.root = await pickDirectory();
    this.writable = (await this.root.queryPermission({ mode: "readwrite" })) === "granted";
  }

  async readNotes(): Promise<ParsedNote[]> {
    return this.readFolder(this.requireRoot(), "");
  }

  async writeReviewState(notePath: string, front: string, review: ReviewState): Promise<void> {
    if (!this.writable) return;

    const file = await this.fileAt(notePath);
    const updated = withReviewState(await (await file.getFile()).text(), front, review);
    await write(file, updated);
  }

  async readConfig(): Promise<GneissConfig> {
    try {
      const directory = await this.requireRoot().getDirectoryHandle(CONFIG_DIR);
      const file = await directory.getFileHandle(CONFIG_FILE);
      return parseConfig(await (await file.getFile()).text());
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async writeConfig(config: GneissConfig): Promise<void> {
    if (!this.writable) return;

    const directory = await this.requireRoot().getDirectoryHandle(CONFIG_DIR, { create: true });
    const file = await directory.getFileHandle(CONFIG_FILE, { create: true });
    await write(file, formatConfig(config));
  }

  private async readFolder(directory: DirectoryHandle, prefix: string): Promise<ParsedNote[]> {
    const notes: ParsedNote[] = [];

    for await (const [name, handle] of directory.entries()) {
      // Skips dotfolders, so `.obsidian` and `.gneiss` never become notes.
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

    return [parseNote(await (await handle.getFile()).text(), path)];
  }

  /** Walks the path segments, since handles are per-directory rather than per-path. */
  private async fileAt(notePath: string): Promise<FileHandle> {
    const segments = notePath.split("/");
    const name = segments.pop() ?? "";

    let directory = this.requireRoot();
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }
    return directory.getFileHandle(name);
  }

  private requireRoot(): DirectoryHandle {
    if (!this.root) throw new Error("no folder has been opened");
    return this.root;
  }
}

async function write(file: FileHandle, contents: string): Promise<void> {
  const stream = await file.createWritable();
  await stream.write(contents);
  await stream.close();
}

function joinPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

/* The File System Access API is not in TypeScript's DOM lib yet, so the surface
   used here is declared rather than pulling in an ambient package. */

interface FileHandle {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryHandle {
  readonly kind: "directory";
  entries(): AsyncIterableIterator<[string, DirectoryHandle | FileHandle]>;
  getDirectoryHandle(name: string, options?: { create: boolean }): Promise<DirectoryHandle>;
  getFileHandle(name: string, options?: { create: boolean }): Promise<FileHandle>;
  queryPermission(options: { mode: "readwrite" }): Promise<"granted" | "denied" | "prompt">;
}

async function pickDirectory(): Promise<DirectoryHandle> {
  const picker = (globalThis as unknown as Record<string, unknown>)["showDirectoryPicker"];
  if (typeof picker !== "function") {
    throw new Error("this browser cannot open a folder — try Chrome or Edge");
  }
  // Asking for readwrite up front means one prompt, not a second one mid-review.
  const pick = picker as (options: { mode: string }) => Promise<DirectoryHandle>;
  return pick({ mode: "readwrite" });
}
