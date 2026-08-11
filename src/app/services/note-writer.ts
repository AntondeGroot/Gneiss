import { Injectable, signal } from "@angular/core";

/**
 * Every write into the vault, one at a time per note.
 *
 * A write is a read-modify-write against the file as it is on disk right now, so
 * two that overlap both read the note *before* either has written it, and the
 * second puts back a copy that never saw the first — a grade quietly undone by an
 * edit that landed at the same moment. Chaining removes the overlap, and keying
 * it per note stops a write to one file waiting on a write to another.
 *
 * It also answers whether a note is being written *at this moment*, which is what
 * lets a screen refuse to hand it to Obsidian mid-write: a file two programs are
 * in at once is how they come to hold different versions of it, and the sync the
 * vault rides on can only keep both.
 *
 * Failures are recorded rather than thrown at the screen. The in-memory change is
 * never rolled back: the user's action genuinely happened, and discarding it would
 * be worse than a note that is briefly out of date, which the error says.
 */
@Injectable({ providedIn: "root" })
export class NoteWriter {
  /** The last write queued for a note, which the next one waits behind. */
  private readonly tails = new Map<string, Promise<unknown>>();
  /**
   * One entry per write still queued or running, so a note written twice appears
   * twice and stays busy until both have finished.
   */
  private readonly inFlight = signal<readonly string[]>([]);

  /** Set when a write failed, so the UI can say so rather than lie. */
  readonly error = signal<string | null>(null);

  /** Whether anything is queued or running for `note`. Read in a template. */
  writing(note: string): boolean {
    return this.inFlight().includes(note);
  }

  /** Runs `write` once everything already queued for that note has finished. */
  async write(note: string, write: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await this.queue(note, async () => write());
      this.error.set(null);
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : String(failure));
    }
  }

  private queue(note: string, write: () => Promise<unknown>): Promise<unknown> {
    this.inFlight.update((notes) => [...notes, note]);

    const done = (this.tails.get(note) ?? Promise.resolve()).then(write);
    // The stored tail must never reject, or one failed write would reject every
    // write queued behind it on that note without any of them being attempted.
    this.tails.set(
      note,
      done.then(
        () => this.done(note),
        () => this.done(note),
      ),
    );
    return done;
  }

  /**
   * Drops one entry, and forgets the note once nothing is left for it — an entry
   * per note ever written would otherwise outlive the session.
   */
  private done(note: string): void {
    this.inFlight.update((notes) => {
      const at = notes.indexOf(note);
      return at === -1 ? notes : [...notes.slice(0, at), ...notes.slice(at + 1)];
    });
    if (!this.writing(note)) this.tails.delete(note);
  }
}
