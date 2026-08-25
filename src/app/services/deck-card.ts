/**
 * A card as the deck holds it, and the pure functions that shape one.
 *
 * Kept apart from `DeckService`, which orchestrates: reading a vault, applying a
 * grade, writing a note. What a card *is* — its identity, its tier, whether its
 * note opted in at all — is decided here, without a service in sight.
 */

import { newReviewState, resolveTier } from "../../vault";
import type { GneissConfig, ParsedNote, ReviewState, Tier, TierMapping } from "../../vault";
import { today } from "./clock.service";

/** A parsed card plus everything scheduling needs to act on it. */
export interface DeckCard {
  /** Note path, question text and occurrence — see `occurrence` on why the last. */
  readonly id: string;
  readonly note: string;
  readonly front: string;
  /**
   * Which card in the note asks this same question, counting from the top.
   *
   * Almost always 0, and load-bearing when it is not: it is what lets a note ask
   * the same question twice and still have two cards that can each hold their
   * own schedule.
   */
  readonly occurrence: number;
  readonly back: string;
  readonly tier: Tier;
  readonly topicTags: string[];
  /** Kept alongside the resolved tier so the card can be re-tiered in place. */
  readonly tierOverride?: Tier;
  readonly review: ReviewState;
  /**
   * Set on both directions of a reversed card, to the same value — the note it
   * came from and where in it. Absent on a one-way card.
   *
   * Carries the note path because the queue sees the whole vault at once, and a
   * position on its own would collide across notes.
   */
  readonly pair?: string;
}

export function toCards(note: ParsedNote, tiers: TierMapping): DeckCard[] {
  const tier = resolveTier(note, tiers);
  return note.cards.map((card) => ({
    id: cardId(note.note, card.front, card.occurrence),
    note: note.note,
    front: card.front,
    occurrence: card.occurrence,
    back: card.back,
    tier,
    topicTags: note.topicTags,
    ...(note.tierOverride ? { tierOverride: note.tierOverride } : {}),
    ...(card.pair === undefined ? {} : { pair: `${note.note}#${card.pair}` }),
    review: card.review ?? newReviewState(today()),
  }));
}

/**
 * The card with its per-note tier tag set or cleared, and its tier resolved
 * again from that.
 *
 * Built by hand rather than by assigning `undefined`: the deck is compiled with
 * `exactOptionalPropertyTypes`, so an absent override and one set to `undefined`
 * are different things.
 */
export function withOverride(
  card: DeckCard,
  override: Tier | undefined,
  config: GneissConfig,
): DeckCard {
  const tierable = { topicTags: card.topicTags, ...(override ? { tierOverride: override } : {}) };

  // Every field named rather than spread: spreading would carry the old override
  // through, and dropping a key by destructuring leaves a variable nothing uses.
  return {
    id: card.id,
    note: card.note,
    front: card.front,
    occurrence: card.occurrence,
    back: card.back,
    topicTags: card.topicTags,
    review: card.review,
    ...(card.pair === undefined ? {} : { pair: card.pair }),
    ...(override ? { tierOverride: override } : {}),
    tier: resolveTier(tierable, config.tiers),
  };
}

/**
 * Only notes the user tagged join the deck.
 *
 * Gneiss never opts a note in: a `::` or a bare `?` can appear in any note, and
 * treating that as a flashcard would adopt half a vault. The `#flashcards` tag
 * is the consent, which also means **removing it takes the cards out again** —
 * without this, untagging a topic changed nothing at all.
 */
export function onlyTagged(notes: readonly ParsedNote[]): readonly ParsedNote[] {
  return notes.filter((note) => note.topicTags.length > 0);
}

/**
 * A card's identity: where it lives, what it asks, and which of the note's cards
 * asking that it is.
 *
 * The occurrence is the part that is easy to leave out and expensive to. Without
 * it a note asking the same question twice produced one identity for two cards,
 * `withoutRepeats` kept one of them, and the vault wrote every grade to the
 * other — so the card on screen could never record one and came back daily.
 */
export function cardId(note: string, front: string, occurrence: number): string {
  return `${note}::${front}#${occurrence}`;
}

/**
 * One card per id, keeping the last seen.
 *
 * A repeat now means the same note was read twice and nothing else: two cards
 * asking the same question differ by their occurrence, and two notes that ask
 * the same thing differ by their path. Both survive, which is right — they are
 * two cards in the vault.
 */
export function withoutRepeats(cards: readonly DeckCard[]): DeckCard[] {
  return [...new Map(cards.map((card) => [card.id, card])).values()];
}
