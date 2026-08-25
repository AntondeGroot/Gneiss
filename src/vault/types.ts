/**
 * Domain types for the vault module.
 *
 * This module is deliberately framework-free and dependency-free: it is lifted
 * as-is into the real Angular app, and is consumed today by the React prototype.
 */

export type Tier = "core" | "standard" | "optional";

export type Grade = "difficult" | "medium" | "easy";

/** Review state as the Obsidian SR plugin stores it, one entry per card. */
export interface ReviewState {
  /** ISO date (YYYY-MM-DD) the card next falls due. */
  due: string;
  /** Days until the next review, as of the last grading. */
  interval: number;
  /** SM-2 ease factor, e.g. 2.3. Stored in markdown as an integer percent. */
  ease: number;
}

export interface ParsedCard {
  front: string;
  back: string;
  /**
   * Which card with this question this is, counting from the top of the note.
   *
   * Nearly always 0. It exists for the note that asks the same question twice —
   * two genuinely different cards, since the answers differ — which the question
   * text alone cannot tell apart. Without it both cards share an identity, the
   * deck keeps one and the vault writes to the other, and the one on screen can
   * never record a grade.
   */
  occurrence: number;
  /** Present only when the note already carried SR state for this card. */
  review?: ReviewState;
  /**
   * Which reversed card in the note this is a direction of — its first line.
   *
   * Absent on a one-way card. Two cards sharing it ask the same material both
   * ways, which is why a session serves only one of them. It is a position, not
   * an identity: it groups the two directions within one read of one note, and
   * nothing durable is keyed on it.
   */
  pair?: number;
}

export interface ParsedNote {
  note: string;
  cards: ParsedCard[];
  /** Topic tags found in the note, e.g. `#flashcards/git`. */
  topicTags: string[];
  /** A per-note `#core` / `#optional` tag, which outranks the tag mapping. */
  tierOverride?: Tier;
}

/** Maps a topic tag to a tier; longest matching prefix wins. */
export type TierMapping = Readonly<Record<string, Tier>>;

export interface CramState {
  /** Topic-tag prefix the cram applies to, e.g. `#flashcards/lang/certexam`. */
  scope: string;
  /** ISO date (YYYY-MM-DD) of the exam. */
  examDate: string;
  /**
   * New cards per session the user intends to take on for this topic — the
   * intensity knob, from gentle to hard. A portion rather than a wall: finishing
   * a session never stops anyone starting another.
   */
  perSession: number;
}
