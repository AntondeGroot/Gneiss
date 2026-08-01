import { Injectable, computed, inject, signal } from "@angular/core";

import {
  DEFAULT_CONFIG,
  newReviewState,
  nextStreak,
  resolveTier,
  schedule,
  selectDue,
  standingStreak,
} from "../../vault";
import type { GneissConfig, Grade, ParsedNote, ReviewState, Tier, TierMapping } from "../../vault";
import { ConfigService } from "./config.service";
import { VaultService } from "./vault.service";

/** A parsed card plus everything scheduling needs to act on it. */
export interface DeckCard {
  /** Note path and question text — see CLAUDE.md on why this identity is fragile. */
  readonly id: string;
  readonly note: string;
  readonly front: string;
  readonly back: string;
  readonly tier: Tier;
  readonly topicTags: string[];
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
  private readonly vault = inject(VaultService);
  private readonly configFile = inject(ConfigService);
  private readonly cards = signal<readonly DeckCard[]>([]);
  private readonly path = signal("");
  /** Where the vault was loaded from, so settings can be written back to it. */
  readonly vaultPath = this.path.asReadonly();

  /** Read from `.gneiss/config.md` in the vault, so it syncs across devices. */
  readonly config = signal<GneissConfig>(DEFAULT_CONFIG);

  /** Set when a write to the vault failed, so the UI can say so rather than lie. */
  readonly writeError = signal<string | null>(null);

  readonly all = this.cards.asReadonly();
  /**
   * Today's queue: due reviews and new cards, each under its own cap, ordered
   * core-first and most-overdue-first. An imported vault's backlog drains over
   * days rather than arriving all at once.
   */
  private readonly selection = computed(() =>
    selectDue(this.cards(), today(), {
      newPerDay: this.config().newPerDay,
      reviewsPerDay: this.config().reviewsPerDay,
    }),
  );

  readonly due = computed(() => this.selection().queue);
  /** Cards held back by today's caps, so the UI can say so rather than hide it. */
  readonly heldBackNew = computed(() => this.selection().heldBackNew);
  readonly heldBackReviews = computed(() => this.selection().heldBackReviews);

  /** Zero once a day has been missed — never claims a streak that is already broken. */
  readonly streak = computed(() =>
    standingStreak(this.config().streak, this.config().lastReviewedOn, today()),
  );

  async load(path: string): Promise<void> {
    this.path.set(path);
    const config = await this.configFile.read(path);
    this.config.set(config);

    const notes = await this.vault.readNotes(path);
    this.cards.set(notes.flatMap((note) => toCards(note, config.tiers)));
  }

  /** Persists settings back into the vault. */
  async saveConfig(path: string, config: GneissConfig): Promise<void> {
    this.config.set(config);
    await this.configFile.write(path, config);
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
      await this.vault.writeReviewState(this.vaultPath(), card.note, card.front, review);
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

    await this.saveConfig(this.vaultPath(), {
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
    review: card.review ?? newReviewState(today()),
  }));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
