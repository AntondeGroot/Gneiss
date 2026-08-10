import { Injectable, computed, effect, inject, signal } from "@angular/core";

import type { CardText, Grade } from "../../vault";
import { isDeckCard } from "./deck-cache.service";
import { DeckService } from "./deck.service";
import { today } from "./clock.service";
import type { DeckCard } from "./deck.service";

const KEY = "gneiss.session";

/** What a session needs to be picked up again after the app has been closed. */
interface SavedSession {
  /** The day it belongs to. Yesterday's session is not resumed. */
  readonly day: string;
  /** The vault it came from, so another vault's cards are never served. */
  readonly vault: string;
  readonly queue: readonly DeckCard[];
  readonly at: number;
  readonly graded: number;
  readonly gradedToday: number;
  readonly sessions: number;
}

/**
 * The review in progress.
 *
 * Held here rather than on the Review screen so that leaving mid-session is
 * leaving, not abandoning: the screen is destroyed on navigation and took the
 * queue with it, so coming back began again from the top. Today can also see
 * what is unfinished, which is what lets it offer to *continue*.
 *
 * The queue is frozen when the session starts. Grading a card takes it out of
 * the due set, so a live queue would reorder itself under the reader while the
 * vault is still loading behind them.
 */
@Injectable({ providedIn: "root" })
export class ReviewSessionService {
  private readonly deck = inject(DeckService);

  private readonly queue = signal<readonly DeckCard[]>([]);
  private readonly at = signal(0);
  /** The vault the open session belongs to, remembered across a restart. */
  private vault = "";

  constructor() {
    this.restore();

    // A session outlives the read that follows it, so cards can vanish beneath
    // it — a note untagged in Obsidian, or deleted outright. Dropping them when
    // the vault has finished is what stops a session asking about material the
    // vault no longer holds.
    effect(() => {
      // `loaded`, not "has cards": a vault whose notes all lost their tag is
      // legitimately empty, and that is exactly the case worth pruning for.
      if (this.deck.reading() || !this.deck.loaded()) return;
      this.dropMissing();
    });
  }

  /**
   * Removes cards the deck no longer has, keeping the place in what is left.
   *
   * The position counts cards, not identities, so anything removed from behind
   * the reader has to shift it back by the same amount — otherwise pruning skips
   * as many cards as it drops.
   */
  private dropMissing(): void {
    const present = new Set(this.deck.all().map((card) => card.id));
    const queue = this.queue();
    if (queue.every((card) => present.has(card.id))) return;

    const survivingBefore = queue.slice(0, this.at()).filter((card) => present.has(card.id)).length;
    this.queue.set(queue.filter((card) => present.has(card.id)));
    this.at.set(survivingBefore);
    this.persist();
  }

  /** Cards graded in this session, and across every session today. */
  readonly graded = signal(0);
  readonly gradedToday = signal(0);
  readonly sessions = signal(0);

  readonly current = computed(() => this.queue()[this.at()] ?? null);
  readonly total = computed(() => this.queue().length);
  readonly remaining = computed(() => Math.max(0, this.total() - this.at()));

  /**
   * A session with cards still in it, belonging to the vault now open.
   *
   * The vault is only checked once it is known: a restored session is read
   * before anything has been opened, and refusing it then would throw away the
   * very thing that was saved.
   */
  readonly unfinished = computed(() => {
    if (this.remaining() === 0) return false;

    const open = this.deck.vaultName();
    return open === "" || this.vault === "" || open === this.vault;
  });

  /** How far through, as a percentage of the queue it began with. */
  readonly progress = computed(() =>
    this.total() === 0 ? 0 : Math.round((this.at() / this.total()) * 100),
  );

  /**
   * Begins a session on whatever is due now.
   *
   * Also how a *second* session starts: the cards graded a moment ago are no
   * longer due, so re-reading picks up what the last one's pace held back. The
   * pace is a target, not a wall.
   */
  start(): void {
    this.vault = this.deck.vaultName();
    this.queue.set([...this.deck.due()]);
    this.at.set(0);
    this.graded.set(0);
    this.sessions.update((count) => count + 1);
    this.persist();
  }

  /** Picks up where the session left off, or starts one if none is open. */
  resume(): void {
    if (!this.unfinished()) this.start();
  }

  grade(grade: Grade): void {
    const card = this.current();
    if (!card) return;

    void this.deck.grade(card, grade);
    this.graded.update((count) => count + 1);
    this.gradedToday.update((count) => count + 1);
    this.at.update((index) => index + 1);

    // Worked through to the end, which is what settles the evening nudge —
    // grading one card and stopping is the day that nudge is there for.
    if (this.remaining() === 0) void this.deck.completeSession();
    this.persist();
  }

  /**
   * Swaps a correction into the queue in progress.
   *
   * The queue was frozen when the session began, so it still holds the old text.
   * Without this the card would go on showing the typo that was just fixed.
   */
  edit(next: CardText): void {
    const card = this.current();
    if (!card) return;

    void this.deck.editCard(card, next);
    this.queue.update((cards) =>
      cards.map((existing) =>
        existing.id === card.id
          ? { ...existing, id: `${card.note}::${next.front}`, ...next }
          : existing,
      ),
    );
    this.persist();
  }

  /** Drops the card from the note and from the queue. */
  remove(): void {
    const card = this.current();
    if (!card) return;

    void this.deck.deleteCard(card);
    // Removing at the current position slides the next card into it, so the
    // position stays put and the session simply carries on.
    this.queue.update((cards) => cards.filter((existing) => existing.id !== card.id));
    this.persist();
  }

  /** The card after this one, so its images can be fetched ahead of time. */
  upcoming(): readonly (DeckCard | undefined)[] {
    return [this.queue()[this.at()], this.queue()[this.at() + 1]];
  }

  /**
   * Puts back a session left open when the app was closed.
   *
   * Only today's, and only this vault's. A session is a plan for a day; picking
   * up yesterday's would serve cards against a queue the day has moved past.
   */
  private restore(): void {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return;

    try {
      const saved = readSession(JSON.parse(raw));
      if (!saved || saved.day !== today()) return;

      this.queue.set(saved.queue);
      this.at.set(saved.at);
      this.graded.set(saved.graded);
      this.gradedToday.set(saved.gradedToday);
      this.sessions.set(saved.sessions);
      this.vault = saved.vault;
    } catch {
      // A half-written or older session is not worth recovering: the cards it
      // held are still due, so the cost is starting a session rather than
      // continuing one.
    }
  }

  /**
   * Writes the session out.
   *
   * Called from each move rather than through an effect: an effect only runs
   * when change detection flushes, so a session could be lost to a kill that
   * arrived first. The queue is one session's worth — a few dozen cards — so
   * saving on every grade is cheap.
   */
  private persist(): void {
    const queue = this.queue();
    // Nothing left to continue — a finished session is not worth putting back,
    // and a stale one would have Today offering to resume an empty queue.
    if (this.remaining() === 0) {
      globalThis.localStorage?.removeItem(KEY);
      return;
    }

    const saved: SavedSession = {
      day: today(),
      vault: this.vault || this.deck.vaultName(),
      queue,
      at: this.at(),
      graded: this.graded(),
      gradedToday: this.gradedToday(),
      sessions: this.sessions(),
    };

    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
    } catch {
      // Storage full or refused. The session still works for this run; only
      // surviving a restart is lost, which is not worth interrupting a review.
    }
  }
}

/** Checks what came back off the device rather than trusting its shape. */
function readSession(parsed: unknown): SavedSession | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const saved = parsed as Partial<Record<keyof SavedSession, unknown>>;
  if (typeof saved.day !== "string" || typeof saved.at !== "number") return null;
  if (!Array.isArray(saved.queue) || !saved.queue.every(isDeckCard)) return null;

  return {
    day: saved.day,
    vault: typeof saved.vault === "string" ? saved.vault : "",
    queue: saved.queue,
    at: saved.at,
    graded: count(saved.graded),
    gradedToday: count(saved.gradedToday),
    sessions: count(saved.sessions),
  };
}

function count(value: unknown): number {
  return typeof value === "number" && value >= 0 ? value : 0;
}
