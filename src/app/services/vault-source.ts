import type { GneissConfig, ParsedNote, ReviewState } from "../../vault";

/** Receives each batch of notes as a vault is read. */
export type NoteBatch = (notes: readonly ParsedNote[]) => void;

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

  /**
   * Reads the vault, handing over notes as they are found.
   *
   * Streaming rather than one payload at the end, because a real vault on a
   * phone takes long enough that a screen showing nothing reads as a hang. Cards
   * become reviewable as they arrive.
   *
   * The contract: every note is delivered to `onBatch` exactly once, and the
   * batches together are the whole vault. The resolved array is the same set,
   * for callers that would rather wait than accumulate.
   */
  readNotes(onBatch?: NoteBatch): Promise<ParsedNote[]>;

  /**
   * Records one card's review state. No-op on a read-only source.
   *
   * The card is named by its question *and* its occurrence within the note, so
   * a note asking the same question twice can still hold two schedules.
   */
  writeReviewState(
    notePath: string,
    front: string,
    occurrence: number,
    review: ReviewState,
  ): Promise<void>;

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

  /**
   * An embedded image, as something an `img` tag can load. Empty when the file
   * cannot be found.
   *
   * `target` is what the note wrote — usually a bare file name, since
   * `![[diagram.png]]` says what to show without saying where it lives, so a
   * source has to resolve it against what the vault actually holds.
   */
  readAttachment(target: string): Promise<string>;

  readConfig(): Promise<GneissConfig>;
  writeConfig(config: GneissConfig): Promise<void>;
}
