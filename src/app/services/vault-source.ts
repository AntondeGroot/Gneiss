import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";

/**
 * Everything Gneiss needs from a vault, independent of where it lives.
 *
 * Two implementations: Capacitor's Filesystem on a device, and the File System
 * Access API in a browser. Nothing above this line — parser, queue, scheduler,
 * screens — knows which one is in play, which is what lets one codebase serve
 * iOS, Android and a laptop.
 */
export interface VaultSource {
  /** Shown in the UI so it is always clear which vault is open. */
  readonly label: string;

  /** False where the platform cannot support this source at all. */
  isAvailable(): boolean;

  /**
   * Whether review state can be written back. A source may legitimately be
   * read-only — the user can decline write permission and still review.
   */
  canWrite(): boolean;

  /**
   * Prepares the source. Native takes a folder path; the browser ignores it and
   * prompts, since the user must choose the folder themselves.
   */
  open(location: string): Promise<void>;

  readNotes(): Promise<ParsedNote[]>;

  /** Records one card's review state. No-op on a read-only source. */
  writeReviewState(notePath: string, front: string, review: ReviewState): Promise<void>;

  /**
   * Reads a note, applies a pure transform, writes the result back. No-op on a
   * read-only source.
   *
   * One primitive rather than a method per operation: editing a card, removing
   * one, and anything later that rewrites a note are all the same read-modify-
   * write, and the interesting part belongs in the vault module where it can be
   * tested without a filesystem.
   */
  editNote(notePath: string, transform: (md: string) => string): Promise<void>;

  /**
   * The vault's own folder name, which is what Obsidian knows it by. Empty when
   * the source cannot say.
   */
  vaultName(): string;

  readConfig(): Promise<GneissConfig>;
  writeConfig(config: GneissConfig): Promise<void>;
}
