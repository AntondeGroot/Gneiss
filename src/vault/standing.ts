/**
 * Why a card is in front of you.
 *
 * The queue only ever serves cards whose due date has arrived, so a card on
 * screen is one of three things: never met, due today, or overdue by some
 * number of days. `ahead` is the fourth case and should be impossible — it is
 * kept so that a card scheduled into the future showing up is *visible* rather
 * than indistinguishable from one that is genuinely due.
 *
 * Reported, not acted on: nothing here changes what is served. It is the answer
 * to "why am I being asked this again", which is otherwise only recoverable by
 * opening the note and reading its `<!--SR:-->` comment.
 */

import { daysBetween } from "./cram.js";
import type { ReviewState } from "./types.js";

export type Standing =
  /** Never graded, so it carries no schedule to be early or late against. */
  | { readonly kind: "new" }
  | { readonly kind: "due" }
  | { readonly kind: "overdue"; readonly days: number }
  | { readonly kind: "ahead"; readonly days: number };

/**
 * The same test the queue uses to tell its two pools apart: a card that has
 * never been graded has no interval, whatever its due date says.
 */
export function cardStanding(review: ReviewState, today: string): Standing {
  if (review.interval <= 0) return { kind: "new" };

  const days = daysBetween(review.due, today);
  if (days > 0) return { kind: "overdue", days };
  if (days < 0) return { kind: "ahead", days: -days };
  return { kind: "due" };
}

/** How many of each kind, so a session can be described before it is started. */
export interface StandingTally {
  readonly fresh: number;
  readonly due: number;
  readonly overdue: number;
  readonly ahead: number;
}

export function tallyStandings(
  cards: readonly { readonly review: ReviewState }[],
  today: string,
): StandingTally {
  const tally = { fresh: 0, due: 0, overdue: 0, ahead: 0 };
  for (const card of cards) {
    const kind = cardStanding(card.review, today).kind;
    if (kind === "new") tally.fresh += 1;
    else if (kind === "due") tally.due += 1;
    else if (kind === "overdue") tally.overdue += 1;
    else tally.ahead += 1;
  }
  return tally;
}
