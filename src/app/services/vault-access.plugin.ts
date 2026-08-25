import { registerPlugin } from "@capacitor/core";

/**
 * The native half of Android vault access, implemented in
 * `android/app/src/main/java/com/gneiss/app/VaultAccessPlugin.kt`.
 *
 * Capacitor's Filesystem plugin cannot do this job: it addresses ordinary file
 * paths, and since Android 11 an app cannot read a folder like the user's
 * Obsidian vault without the all-files permission Google reserves for file
 * managers. The Storage Access Framework asks for one folder instead, and keeps
 * the grant across reboots.
 */
export interface PickedVault {
  readonly uri: string;
  readonly name: string;
  /** False when a remembered folder is no longer shared with the app. */
  readonly available: boolean;
}

export interface VaultNote {
  /** Path relative to the vault root, e.g. `Programming/git.md`. */
  readonly path: string;
  readonly contents: string;
}

export interface VaultAccessPlugin {
  /** Opens the system folder picker and persists the grant. */
  pick(): Promise<PickedVault>;
  /** Whether a remembered folder is still readable, without prompting. */
  reopen(options: { uri: string }): Promise<PickedVault>;
  /**
   * Walks the vault, emitting `vaultNotes` events as it reads, and resolving
   * with the total once the walk is done.
   *
   * Streamed rather than returned whole: a large vault takes long enough on a
   * phone that a screen showing nothing reads as a hang.
   */
  readNotes(options: {
    uri: string;
  }): Promise<{ total: number; attachments: Record<string, string> }>;
  /** One attachment as a data URL, read only when a card asks for it. */
  readAttachment(options: {
    uri: string;
    path: string;
  }): Promise<{ dataUrl: string; found: boolean }>;
  addListener(
    event: "vaultNotes",
    handler: (payload: { notes: VaultNote[] }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  /**
   * The attachment index, sent as soon as the vault has been listed — well
   * before the notes have been read, so a card shown early can still find its
   * image.
   */
  addListener(
    event: "vaultAttachments",
    handler: (payload: { attachments: Record<string, string> }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  readFile(options: { uri: string; path: string }): Promise<{ contents: string; found: boolean }>;
  writeFile(options: { uri: string; path: string; contents: string }): Promise<void>;
  /** Removes one file. `deleted` is false when it was not there to begin with. */
  deleteFile(options: { uri: string; path: string }): Promise<{ deleted: boolean }>;
}

export const VaultAccess = registerPlugin<VaultAccessPlugin>("VaultAccess");
