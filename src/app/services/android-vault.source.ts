import { Injectable } from "@angular/core";
import { Capacitor } from "@capacitor/core";

import { DEFAULT_CONFIG, formatConfig, parseConfig, parseNote, withReviewState } from "../../vault";
import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";
import { VaultAccess } from "./vault-access.plugin";
import type { VaultSource } from "./vault-source";

const CONFIG_PATH = ".gneiss/config.md";
/** Where the picked folder is remembered, so the vault is chosen once, not daily. */
const REMEMBERED = "gneiss.android.vault";

/**
 * The vault as a folder the user picks on Android, through the Storage Access
 * Framework.
 *
 * The same bargain as `BrowserVaultSource` on a laptop: one folder, chosen by
 * the user, and nothing else on the device is reachable. Both keep the "pick
 * your vault once" model identical above `VaultSource`, which is what lets the
 * screens stay unaware of the platform.
 */
@Injectable({ providedIn: "root" })
export class AndroidVaultSource implements VaultSource {
  private uri = "";
  private name = "";

  readonly label = "Vault folder";

  isAvailable(): boolean {
    return Capacitor.getPlatform() === "android";
  }

  /** A grant covers reading and writing together, so an open vault is writable. */
  canWrite(): boolean {
    return this.uri !== "";
  }

  /** The folder picked last time, if there is one. Empty on a first run. */
  remembered(): string {
    return globalThis.localStorage?.getItem(REMEMBERED) ?? "";
  }

  /**
   * Opens a vault: a remembered URI is reopened silently, anything else prompts.
   *
   * A remembered folder can stop being readable — the grant revoked, the folder
   * moved — and that is reported rather than quietly replaced with a picker,
   * because a prompt the user did not ask for is how the wrong folder gets
   * chosen.
   */
  async open(location: string): Promise<void> {
    const picked = location.startsWith("content://")
      ? await VaultAccess.reopen({ uri: location })
      : await VaultAccess.pick();

    if (!picked.available) {
      throw new Error("that folder is no longer shared with Gneiss — pick it again");
    }

    this.uri = picked.uri;
    this.name = picked.name;
    globalThis.localStorage?.setItem(REMEMBERED, picked.uri);
  }

  async readNotes(): Promise<ParsedNote[]> {
    const { notes } = await VaultAccess.readNotes({ uri: this.require() });
    return notes.map((note) => parseNote(note.contents, note.path));
  }

  writeReviewState(notePath: string, front: string, review: ReviewState): Promise<void> {
    return this.editNote(notePath, (md) => withReviewState(md, front, review));
  }

  async editNote(notePath: string, transform: (md: string) => string): Promise<void> {
    const uri = this.require();
    const { contents } = await VaultAccess.readFile({ uri, path: notePath });
    await VaultAccess.writeFile({ uri, path: notePath, contents: transform(contents) });
  }

  vaultName(): string {
    return this.name;
  }

  /** Falls back to defaults when the file is absent, as on first launch. */
  async readConfig(): Promise<GneissConfig> {
    const { contents, found } = await VaultAccess.readFile({
      uri: this.require(),
      path: CONFIG_PATH,
    });
    return found ? parseConfig(contents) : DEFAULT_CONFIG;
  }

  writeConfig(config: GneissConfig): Promise<void> {
    return VaultAccess.writeFile({
      uri: this.require(),
      path: CONFIG_PATH,
      contents: formatConfig(config),
    });
  }

  private require(): string {
    if (!this.uri) throw new Error("no vault folder is open");
    return this.uri;
  }
}
