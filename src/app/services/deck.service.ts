import { Injectable, computed, signal } from "@angular/core";

import {
  DEFAULT_CONFIG,
  cramPlan,
  distinctTopicTags,
  isCrammed,
  newReviewState,
  nextStreak,
  resolveTier,
  schedule,
  selectDue,
  standingStreak,
} from "../../vault";
import type { GneissConfig, Grade, ParsedNote, ReviewState, Tier, TierMapping } from "../../vault";
import type { VaultSource } from "./vault-source";

/** A parsed card plus everything scheduling needs to act on it. */
export interface DeckCard {
  /** Note path and question text — see CLAUDE.md on why this identity is fragile. */
  readonly id: string;
  readonly note: string;
  readonly front: string;
  readonly back: string;
  readonly tier: Tier;
  readonly topicTags: string[];
  /** Kept alongside the resolved tier so the card can be re-tiered in place. */
  readonly tierOverride?: Tier;
  readonly review: ReviewState;
}

/**
 * Holds the deck for the session: reads the vault once, flattens it into cards,
 * and applies grades.
 *
 * Grading updates the card in memory and then records it in the note it came
 * from, so progress survives a restart and syncs with the vault.
 */
@Injectable({ providedIn: "root" })
export class DeckService {
  private source: VaultSource | null = null;
  private readonly cards = signal<readonly DeckCard[]>([]);
  /**
   * The vault's topic tags, so Settings can offer a row per topic. Taken from the
   * notes rather than the cards: a note tagged but not yet filled in still names
   * a topic the user means to tier.
   */
  private readonly topics = signal<readonly string[]>([]);
  /** The open vault, so the UI can name it and know whether writes are possible. */
  readonly sourceLabel = signal("");
  readonly canWrite = signal(false);

  /** Read from `.gneiss/config.md` in the vault, so it syncs across devices. */
  readonly config = signal<GneissConfig>(DEFAULT_CONFIG);

  /** Set when a write to the vault failed, so the UI can say so rather than lie. */
  readonly writeError = signal<string | null>(null);

  readonly all = this.cards.asReadonly();
  readonly topicTags = this.topics.asReadonly();
  /**
   * Today's queue: due reviews and new cards, each under its own cap, ordered
   * core-first and most-overdue-first. An imported vault's backlog drains over
   * days rather than arriving all at once.
   */
  private readonly selection = computed(() =>
    selectDue(this.cards(), today(), {
      newPerSession: this.config().newPerSession,
      reviewsPerSession: this.config().reviewsPerSession,
      cram: this.config().cram,
    }),
  );

  readonly due = computed(() => this.selection().queue);
  /** Cards held back by today's caps, so the UI can say so rather than hide it. */
  readonly heldBackNew = computed(() => this.selection().heldBackNew);
  readonly heldBackReviews = computed(() => this.selection().heldBackReviews);
  /** Crammed cards beyond today's chosen pace — next in line, not withheld. */
  readonly heldCrammed = computed(() => this.selection().heldCrammed);

  /**
   * How the cram is going and what pace the deadline demands, or null when none
   * is running. An expired cram reads as absent, so the date is the off-switch
   * here too and no manual reset is needed.
   */
  readonly cram = computed(() =>
    cramPlan(this.cards(), this.config().cram, this.config().cramMinPasses, today()),
  );

  /** The cram's topic tag, for naming it on screen. */
  readonly cramScope = computed(() => this.config().cram?.scope ?? "");

  /** Due cards inside the cram's scope — what the countdown is actually about. */
  readonly cramDue = computed(() =>
    this.due().filter((card) => isCrammed(card.topicTags, this.config().cram)),
  );

  /** Zero once a day has been missed — never claims a streak that is already broken. */
  readonly streak = computed(() =>
    standingStreak(this.config().streak, this.config().lastReviewedOn, today()),
  );

  /** Opens a vault from any source, then reads its config and notes. */
  async open(source: VaultSource, location: string): Promise<void> {
    await source.open(location);
    this.source = source;
    this.sourceLabel.set(source.label);
    this.canWrite.set(source.canWrite());

    this.config.set(await source.readConfig());
    this.setNotes(await source.readNotes());
  }

  /**
   * Loads already-parsed notes, for sources other than the device filesystem.
   * The vault path stays empty, which is what keeps write-back from firing
   * against a folder Gneiss did not read through VaultService.
   */
  setNotes(notes: readonly ParsedNote[]): void {
    this.topics.set(distinctTopicTags(notes));
    this.cards.set(notes.flatMap((note) => toCards(note, this.config().tiers)));
  }

  /**
   * Persists settings back into the vault, and re-tiers the deck so an edit to
   * the tag mapping takes effect on this session's cards rather than only on the
   * next load.
   */
  async saveConfig(config: GneissConfig): Promise<void> {
    this.config.set(config);
    this.cards.update((cards) =>
      cards.map((card) => ({ ...card, tier: resolveTier(card, config.tiers) })),
    );
    await this.source?.writeConfig(config);
  }

  /** What the interval would become, without committing the grade. */
  preview(card: DeckCard, grade: Grade): ReviewState {
    return schedule(card.review, grade, this.optionsFor(card));
  }

  /**
   * Applies the grade in memory immediately, then persists it. The in-memory
   * update is not rolled back on a write failure: the grade genuinely happened,
   * and losing it would be worse than a note that is briefly out of date.
   */
  async grade(card: DeckCard, grade: Grade): Promise<void> {
    const review = this.preview(card, grade);
    this.cards.update((cards) =>
      cards.map((existing) => (existing.id === card.id ? { ...existing, review } : existing)),
    );

    try {
      await this.source?.writeReviewState(card.note, card.front, review);
      await this.recordReviewDay();
      this.writeError.set(null);
    } catch (error) {
      this.writeError.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Advances the streak on the first review of a new day, and persists it. */
  private async recordReviewDay(): Promise<void> {
    const config = this.config();
    if (config.lastReviewedOn === today()) return;

    await this.saveConfig({
      ...config,
      streak: nextStreak(config.streak, config.lastReviewedOn, today()),
      lastReviewedOn: today(),
    });
  }

  private optionsFor(card: DeckCard) {
    return {
      tier: card.tier,
      spread: this.config().spread,
      today: today(),
      topicTags: card.topicTags,
      cram: this.config().cram,
    };
  }
}

function toCards(note: ParsedNote, tiers: TierMapping): DeckCard[] {
  const tier = resolveTier(note, tiers);
  return note.cards.map((card) => ({
    id: `${note.note}::${card.front}`,
    note: note.note,
    front: card.front,
    back: card.back,
    tier,
    topicTags: note.topicTags,
    ...(note.tierOverride ? { tierOverride: note.tierOverride } : {}),
    review: card.review ?? newReviewState(today()),
  }));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
