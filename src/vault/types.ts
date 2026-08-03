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
  /** Present only when the note already carried SR state for this card. */
  review?: ReviewState;
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
  active: boolean;
  /** Topic-tag prefix the cram applies to, e.g. `#flashcards/lang/certexam`. */
  scope: string;
  /** ISO date (YYYY-MM-DD) of the exam. */
  examDate: string;
  /**
   * New cards a day the user intends to take on for this topic — the intensity
   * knob, from gentle to hard. A target rather than a wall: finishing the day's
   * queue never stops anyone starting another session.
   */
  perDay: number;
}
