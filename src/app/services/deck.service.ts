import { Injectable, computed, inject, signal } from "@angular/core";

import { isDue, newReviewState, resolveTier, schedule } from "../../vault";
import type { CramState, Grade, ParsedNote, ReviewState, Tier, TierMapping } from "../../vault";
import { VaultService } from "./vault.service";

// TODO: belongs in .gneiss/config.md inside the vault, so it syncs with the notes.
const TIER_MAPPING: TierMapping = {
  "#flashcards/git": "core",
  "#flashcards/shell": "core",
  "#flashcards/tools": "standard",
  "#flashcards/lang": "standard",
};

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
 * Review state currently lives in memory only. Writing it back into each note's
 * `<!--SR:-->` comment is the next step and deliberately not done here yet, so
 * nothing in this service modifies the vault.
 */
@Injectable({ providedIn: "root" })
export class DeckService {
  private readonly vault = inject(VaultService);
  private readonly cards = signal<readonly DeckCard[]>([]);

  /** Core emphasis, 0..1. TODO: move to Settings alongside the tier mapping. */
  readonly spread = signal(0.8);
  readonly cram = signal<CramState | null>(null);

  readonly all = this.cards.asReadonly();
  readonly due = computed(() => this.cards().filter((card) => isDue(card.review, today())));

  async load(path: string): Promise<void> {
    const notes = await this.vault.readNotes(path);
    this.cards.set(notes.flatMap(toCards));
  }

  /** What the interval would become, without committing the grade. */
  preview(card: DeckCard, grade: Grade): ReviewState {
    return schedule(card.review, grade, this.optionsFor(card));
  }

  grade(card: DeckCard, grade: Grade): void {
    const review = this.preview(card, grade);
    this.cards.update((cards) =>
      cards.map((existing) => (existing.id === card.id ? { ...existing, review } : existing)),
    );
  }

  private optionsFor(card: DeckCard) {
    return {
      tier: card.tier,
      spread: this.spread(),
      today: today(),
      topicTags: card.topicTags,
      cram: this.cram(),
    };
  }
}

function toCards(note: ParsedNote): DeckCard[] {
  const tier = resolveTier(note, TIER_MAPPING);
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
