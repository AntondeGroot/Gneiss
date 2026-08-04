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
   * Every markdown note under the vault, walked and read natively.
   *
   * One call rather than a listing plus a read per file: each hop across the
   * bridge costs, and a real vault holds hundreds of notes.
   */
  readNotes(options: { uri: string }): Promise<{ notes: VaultNote[] }>;
  readFile(options: { uri: string; path: string }): Promise<{ contents: string; found: boolean }>;
  writeFile(options: { uri: string; path: string; contents: string }): Promise<void>;
}

export const VaultAccess = registerPlugin<VaultAccessPlugin>("VaultAccess");
