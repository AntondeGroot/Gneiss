import { Injectable, computed, inject, signal } from "@angular/core";

import { DEFAULT_CONFIG, isDue, newReviewState, resolveTier, schedule } from "../../vault";
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
  private readonly vaultPath = signal("");

  /** Read from `.gneiss/config.md` in the vault, so it syncs across devices. */
  readonly config = signal<GneissConfig>(DEFAULT_CONFIG);

  /** Set when a write to the vault failed, so the UI can say so rather than lie. */
  readonly writeError = signal<string | null>(null);

  readonly all = this.cards.asReadonly();
  readonly due = computed(() => this.cards().filter((card) => isDue(card.review, today())));

  async load(path: string): Promise<void> {
    this.vaultPath.set(path);
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
      this.writeError.set(null);
    } catch (error) {
      this.writeError.set(error instanceof Error ? error.message : String(error));
    }
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
