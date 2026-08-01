import { Injectable } from "@angular/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { parseNote } from "../../vault";
import type { ParsedNote } from "../../vault";

const MARKDOWN_EXTENSION = ".md";

/** Where the Obsidian vault lives on the device. */
export interface VaultLocation {
  /** Path relative to `directory`, e.g. "Obsidian/Programming". */
  readonly path: string;
  readonly directory: Directory;
}

/**
 * Reads an Obsidian vault off the filesystem and parses it into cards.
 *
 * Gneiss does not own the vault: this service only ever reads. Writing review
 * state back is a separate concern, deliberately not mixed in here.
 */
@Injectable({ providedIn: "root" })
export class VaultService {
  /** Every markdown note in the vault, including those in subfolders. */
  async readNotes(location: VaultLocation): Promise<ParsedNote[]> {
    const paths = await this.collectMarkdownPaths(location, "");
    return Promise.all(paths.map((path) => this.readNote(location, path)));
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
