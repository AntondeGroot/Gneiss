import { Injectable } from "@angular/core";

import {
  DEFAULT_CONFIG,
  editedNote,
  formatConfig,
  parseConfig,
  parseNote,
  withReviewState,
} from "../../vault";
import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";
import type { NoteBatch, VaultSource } from "./vault-source";

const MARKDOWN = ".md";
const CONFIG_DIR = ".gneiss";
const CONFIG_FILE = "config.md";
/** Notes per batch — enough that the first cards appear at once. */
const BATCH_SIZE = 25;

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
  /** Attachment file name to handle, collected by the walk that reads the notes. */
  private attachments = new Map<string, FileHandle>();

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

  /** Streams notes as the walk descends, so a large vault fills in as it reads. */
  async readNotes(onBatch?: NoteBatch): Promise<ParsedNote[]> {
    this.attachments.clear();
    return this.readFolder(this.requireRoot(), "", onBatch);
  }

  /** An embedded image as a data URL, read from the handle the walk kept. */
  async readAttachment(target: string): Promise<string> {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;

    const handle = this.attachments.get(target.split("/").pop() ?? target);
    if (!handle) return "";
    return toDataUrl(await handle.getFile());
  }

  writeReviewState(
    notePath: string,
    front: string,
    occurrence: number,
    review: ReviewState,
  ): Promise<void> {
    return this.editNote(notePath, (md) => withReviewState(md, front, occurrence, review));
  }

  async editNote(notePath: string, transform: (md: string) => string): Promise<void> {
    if (!this.writable) return;

    const file = await this.fileAt(notePath);
    const edited = editedNote(await (await file.getFile()).text(), transform);
    if (edited === null) return;

    await write(file, edited);
  }

  /** The folder the user picked, which is the vault root by our own convention. */
  vaultName(): string {
    return this.root?.name ?? "";
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

  private async readFolder(
    directory: DirectoryHandle,
    prefix: string,
    onBatch?: NoteBatch,
  ): Promise<ParsedNote[]> {
    const notes: ParsedNote[] = [];
    let pending: ParsedNote[] = [];

    for await (const [name, handle] of directory.entries()) {
      // Skips dotfolders, so `.obsidian` and `.gneiss` never become notes.
      if (name.startsWith(".")) continue;

      const found = await this.readEntry(handle, joinPath(prefix, name), name, onBatch);
      notes.push(...found);
      // Subfolders have already reported their own; only files land here.
      if (handle.kind !== "directory") pending.push(...found);
      if (pending.length >= BATCH_SIZE) {
        onBatch?.(pending);
        pending = [];
      }
    }

    if (pending.length > 0) onBatch?.(pending);
    return notes;
  }

  private async readEntry(
    handle: DirectoryHandle | FileHandle,
    path: string,
    name: string,
    onBatch?: NoteBatch,
  ): Promise<ParsedNote[]> {
    if (handle.kind === "directory") return this.readFolder(handle, path, onBatch);
    if (!name.toLowerCase().endsWith(MARKDOWN)) {
      // Everything that is not a note is a possible attachment. The handle is
      // kept, not the bytes: an image is read when a card asks to show it.
      this.attachments.set(name, handle);
      return [];
    }

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

/** Read as a data URL so it can go straight into an `img` tag. */
async function toDataUrl(file: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve) => {
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      resolve("");
    };
    reader.readAsDataURL(file);
  });
}

interface FileHandle {
  readonly kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
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
