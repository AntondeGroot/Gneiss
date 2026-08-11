import { Injectable } from "@angular/core";
import { Capacitor } from "@capacitor/core";

import {
  DEFAULT_CONFIG,
  editedNote,
  formatConfig,
  parseConfig,
  parseNote,
  withReviewState,
} from "../../vault";
import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";
import { VaultAccess } from "./vault-access.plugin";
import type { NoteBatch, VaultSource } from "./vault-source";

const CONFIG_PATH = ".gneiss/config.md";
/** Where the picked folder is remembered, so the vault is chosen once, not daily. */
const REMEMBERED = "gneiss.android.vault";
/**
 * The folder's name, kept beside its URI so the cached deck can be found before
 * the vault is opened. Stored rather than derived: how a tree URI maps to a name
 * is the document provider's business, and guessing it here would be a second,
 * quietly diverging copy of that rule.
 */
const REMEMBERED_NAME = "gneiss.android.vaultName";

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
  /**
   * Attachment file name to path, collected by the walk that reads the notes.
   *
   * Built there because the walk already lists every entry — finding an image
   * later would mean a second pass over the whole vault, once per card.
   */
  private attachments: Record<string, string> = {};

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

  /** That folder's name, which is the key the cached deck is stored under. */
  rememberedName(): string {
    return globalThis.localStorage?.getItem(REMEMBERED_NAME) ?? "";
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
    globalThis.localStorage?.setItem(REMEMBERED_NAME, picked.name);
  }

  /**
   * Reads the vault, handing each batch on as the native walk emits it.
   *
   * The listener is removed in a `finally`, so a walk that fails partway does
   * not leave a subscription behind that would double up the next read.
   */
  async readNotes(onBatch?: NoteBatch): Promise<ParsedNote[]> {
    // Checked before subscribing: no vault means no walk, and a listener left
    // attached to a call that never happens would double the next read.
    const uri = this.require();
    const all: ParsedNote[] = [];

    const notes = await VaultAccess.addListener("vaultNotes", ({ notes: batch }) => {
      const parsed = batch.map((note) => parseNote(note.contents, note.path));
      all.push(...parsed);
      onBatch?.(parsed);
    });
    // Arrives once the vault has been listed, long before it has been read.
    const index = await VaultAccess.addListener("vaultAttachments", ({ attachments }) => {
      this.attachments = attachments;
    });

    try {
      const { attachments } = await VaultAccess.readNotes({ uri });
      this.attachments = attachments;
    } finally {
      await notes.remove();
      await index.remove();
    }
    return all;
  }

  writeReviewState(notePath: string, front: string, review: ReviewState): Promise<void> {
    return this.editNote(notePath, (md) => withReviewState(md, front, review));
  }

  async editNote(notePath: string, transform: (md: string) => string): Promise<void> {
    const uri = this.require();
    const { contents } = await VaultAccess.readFile({ uri, path: notePath });

    const edited = editedNote(contents, transform);
    if (edited === null) return;

    await VaultAccess.writeFile({ uri, path: notePath, contents: edited });
  }

  vaultName(): string {
    return this.name;
  }

  /**
   * An embedded image as a data URL.
   *
   * A bare `![[diagram.png]]` is looked up in the index the walk built; anything
   * with a path is tried as written first, which is what the markdown form
   * gives. An external address is handed back untouched for the browser to fetch.
   */
  async readAttachment(target: string): Promise<string> {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;

    const path = this.attachments[target] ?? this.attachments[basename(target)] ?? target;
    const { dataUrl } = await VaultAccess.readAttachment({ uri: this.require(), path });
    return dataUrl;
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

/** The file name out of a path, which is how the index is keyed. */
function basename(target: string): string {
  return target.split("/").pop() ?? target;
}
