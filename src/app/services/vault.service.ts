import { Injectable } from "@angular/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { parseNote, withReviewState } from "../../vault";
import type { ParsedNote, ReviewState } from "../../vault";

const MARKDOWN_EXTENSION = ".md";

/**
 * Where the Obsidian vault lives on the device. Internal: Capacitor's `Directory`
 * enum is an implementation detail and must not leak to callers, or every screen
 * would need to know about the native filesystem.
 */
interface VaultLocation {
  /** Path relative to `directory`, e.g. "Obsidian/Programming". */
  readonly path: string;
  readonly directory: Directory;
}

/**
 * Reads an Obsidian vault off the filesystem and parses it into cards, and
 * writes back into the notes.
 *
 * Gneiss does not own the vault, and writes only what the user asked for: a
 * card's `<!--SR:-->` comment as they grade it, and a card's own text when they
 * edit or remove one during review. Prose around a card, headings, tags and
 * every other note are never the app's to change.
 *
 * **CORRECTED:** this once said the SR comment was the only thing ever written.
 * Editing a card during review makes that false — but the boundary it was
 * protecting still holds, one card's span at a time.
 */
@Injectable({ providedIn: "root" })
export class VaultService {
  // TODO: on iOS the user picks the folder and this becomes a stored bookmark.
  private readonly directory = Directory.Documents;

  /**
   * Every markdown note under `path`, including those in subfolders.
   *
   * @param path Vault folder relative to the app's documents directory.
   */
  async readNotes(path: string): Promise<ParsedNote[]> {
    const location: VaultLocation = { path, directory: this.directory };
    const paths = await this.collectMarkdownPaths(location, "");
    return Promise.all(paths.map((notePath) => this.readNote(location, notePath)));
  }

  /** Records a card's review state in its note. */
  writeReviewState(
    vaultPath: string,
    notePath: string,
    front: string,
    review: ReviewState,
  ): Promise<void> {
    return this.editNote(vaultPath, notePath, (md) => withReviewState(md, front, review));
  }

  /**
   * Rewrites one note through a pure transform.
   *
   * Read-modify-write on the file as it is on disk right now, not on a cached
   * copy, so a note edited in Obsidian since the last read keeps those edits.
   */
  async editNote(
    vaultPath: string,
    notePath: string,
    transform: (md: string) => string,
  ): Promise<void> {
    const full = joinPath(vaultPath, notePath);

    const { data } = await Filesystem.readFile({
      path: full,
      directory: this.directory,
      encoding: Encoding.UTF8,
    });

    await Filesystem.writeFile({
      path: full,
      data: transform(await asText(data)),
      directory: this.directory,
      encoding: Encoding.UTF8,
    });
  }

  /** Depth-first walk — real vaults organise notes into folders. */
  private async collectMarkdownPaths(
    location: VaultLocation,
    relativePath: string,
  ): Promise<string[]> {
    const entries = await this.listEntries(location, relativePath);
    const paths: string[] = [];

    for (const entry of entries) {
      paths.push(...(await this.pathsWithin(location, relativePath, entry)));
    }
    return paths;
  }

  private async pathsWithin(
    location: VaultLocation,
    relativePath: string,
    entry: DirectoryEntry,
  ): Promise<string[]> {
    if (isHidden(entry.name)) return [];

    const entryPath = joinPath(relativePath, entry.name);
    if (entry.type === "directory") return this.collectMarkdownPaths(location, entryPath);
    return isMarkdown(entry.name) ? [entryPath] : [];
  }

  private async listEntries(
    location: VaultLocation,
    relativePath: string,
  ): Promise<DirectoryEntry[]> {
    const { files } = await Filesystem.readdir({
      path: joinPath(location.path, relativePath),
      directory: location.directory,
    });
    return files;
  }

  private async readNote(location: VaultLocation, relativePath: string): Promise<ParsedNote> {
    const { data } = await Filesystem.readFile({
      path: joinPath(location.path, relativePath),
      directory: location.directory,
      encoding: Encoding.UTF8,
    });
    return parseNote(await asText(data), relativePath);
  }
}

interface DirectoryEntry {
  readonly name: string;
  readonly type: "directory" | "file";
}

/**
 * Skips dotfolders — `.obsidian` alone holds hundreds of config and plugin files
 * that would otherwise be walked on every read.
 */
function isHidden(name: string): boolean {
  return name.startsWith(".");
}

function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith(MARKDOWN_EXTENSION);
}

function joinPath(base: string, relative: string): string {
  if (!base) return relative;
  if (!relative) return base;
  return `${base}/${relative}`;
}

/** readFile resolves to a string on native, but a Blob on the web platform. */
async function asText(data: string | Blob): Promise<string> {
  return typeof data === "string" ? data : data.text();
}
