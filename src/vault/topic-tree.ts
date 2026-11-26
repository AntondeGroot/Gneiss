/**
 * The vault's topics as a tree, each with what is waiting in it.
 *
 * The shape the Obsidian SR plugin's deck list has: a row per `#flashcards/…`
 * tag, a parent counting its subtopics too, so `lang` covers `lang/certexam`.
 * A row is also how a topic is *chosen* — reviewing one by hand, or practising
 * one known to be weak — so its counts say what each choice would draw on.
 *
 * Weakness is read from ease, which every card already carries in its
 * `<!--SR:-->` comment and which every Difficult grade lowers. Nothing new is
 * stored to know which topics are struggling: the vault already says so.
 */

import { isWithinScope } from "./cram.js";
import { isDue, STARTING_EASE } from "./schedule.js";
import type { ReviewState } from "./types.js";

const TOPIC_ROOT = "#flashcards";
const SEPARATOR = "/";

/**
 * Below this average ease a topic is flagged as weak: a Difficult and a half per
 * card under where every card starts. Medium nudges ease down too, but it takes
 * fifteen in a row — years, at growing intervals — so in practice reaching it
 * means the topic keeps being forgotten.
 */
export const WEAK_EASE = STARTING_EASE - 0.3;

/** Fewer cards met than this is too few to call a topic weak rather than unlucky. */
export const WEAK_MINIMUM_MET = 5;

export interface Countable {
  readonly topicTags: readonly string[];
  readonly review: ReviewState;
}

export interface TopicRow {
  readonly tag: string;
  /** The tag's last segment: `#flashcards/lang/certexam` reads as `certexam`. */
  readonly label: string;
  /** 0 for a top-level topic, one more per level beneath it. */
  readonly depth: number;
  readonly hasChildren: boolean;
  /** Cards in rotation whose day has come. */
  readonly due: number;
  /** Cards never met. */
  readonly fresh: number;
  /** Cards in rotation not due yet — what practising ahead can serve. */
  readonly ahead: number;
  readonly total: number;
  /** Average ease of the cards met so far; null while none have been. */
  readonly ease: number | null;
  readonly weak: boolean;
}

/**
 * One row per topic holding cards, parents before their children.
 *
 * A parent appears even when no note carries its tag directly: `lang` is a
 * topic as soon as `lang/certexam` is, which is what lets one row cover a whole
 * subject. A topic whose notes hold no cards yet has nothing to review, so it
 * has no row.
 */
export function topicRows(
  cards: readonly Countable[],
  topicTags: readonly string[],
  today: string,
): TopicRow[] {
  const tags = withAncestors(topicTags).sort(bySegments);
  return tags
    .map((tag) =>
      toRow(
        tag,
        tags,
        cards.filter((card) => isInTopic(card, tag)),
        today,
      ),
    )
    .filter((row) => row.total > 0);
}

/**
 * The topic most worth practising, or null when none stands out.
 *
 * The lowest ease among the weak, and on a tie the more specific: pointing at
 * `lang/generics` says more than pointing at all of `lang`.
 */
export function weakestTopic(rows: readonly TopicRow[]): TopicRow | null {
  const weak = rows.filter((row) => row.weak);
  weak.sort((a, b) => (a.ease ?? 0) - (b.ease ?? 0) || b.depth - a.depth);
  return weak[0] ?? null;
}

/** Whether a card belongs to a topic, itself or one of its subtopics. */
export function isInTopic(card: { readonly topicTags: readonly string[] }, tag: string): boolean {
  return card.topicTags.some((own) => isWithinScope(own, tag));
}

function toRow(
  tag: string,
  tags: readonly string[],
  cards: readonly Countable[],
  today: string,
): TopicRow {
  const met = cards.filter((card) => card.review.interval > 0);
  const due = met.filter((card) => isDue(card.review, today)).length;
  const ease = met.length === 0 ? null : averageEase(met);
  const segments = tag.split(SEPARATOR);

  return {
    tag,
    label: (segments.at(-1) ?? tag).replace(/^#/, ""),
    depth: Math.max(0, segments.length - 2),
    hasChildren: tags.some((other) =>
      other.toLowerCase().startsWith(tag.toLowerCase() + SEPARATOR),
    ),
    due,
    fresh: cards.length - met.length,
    ahead: met.length - due,
    total: cards.length,
    ease,
    weak: ease !== null && met.length >= WEAK_MINIMUM_MET && ease < WEAK_EASE,
  };
}

function averageEase(cards: readonly Countable[]): number {
  return cards.reduce((sum, card) => sum + card.review.ease, 0) / cards.length;
}

/**
 * Every tag plus each level above it, once each, ignoring case.
 *
 * The bare `#flashcards` is left out: it would be a row holding the whole deck,
 * which is what Today already is.
 */
function withAncestors(topicTags: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const tag of topicTags) {
    const segments = tag.split(SEPARATOR);
    for (let length = 1; length <= segments.length; length += 1) {
      const level = segments.slice(0, length).join(SEPARATOR);
      if (level.toLowerCase() === TOPIC_ROOT) continue;
      if (!byKey.has(level.toLowerCase())) byKey.set(level.toLowerCase(), level);
    }
  }
  return [...byKey.values()];
}

/**
 * Segment by segment, so a parent sorts directly above its children. Comparing
 * whole strings would put `lang-x` between `lang` and `lang/certexam`.
 */
function bySegments(a: string, b: string): number {
  const left = a.toLowerCase().split(SEPARATOR);
  const right = b.toLowerCase().split(SEPARATOR);
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = (left[index] ?? "").localeCompare(right[index] ?? "");
    if (order !== 0) return order;
  }
  return left.length - right.length;
}
