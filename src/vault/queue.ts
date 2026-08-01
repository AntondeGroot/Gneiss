/**
 * Choosing what to review today.
 *
 * An existing vault arrives with a backlog: notes scheduled years ago are all
 * overdue at once. Nothing is rescheduled to hide that — those cards really are
 * due — but the day's queue is capped so the backlog drains over time instead of
 * presenting hundreds of cards in one session, which is how an SRS gets abandoned.
 */

import { isDue } from "./schedule.js";
import type { ReviewState, Tier } from "./types.js";

/** The minimum a card needs for the queue to order and count it. */
export interface Schedulable {
  readonly tier: Tier;
  readonly review: ReviewState;
}

export interface DailyLimits {
  /** Ceiling on cards never seen before. */
  readonly newPerDay: number;
  /** Ceiling on cards already in rotation, which is what a backlog fills. */
  readonly reviewsPerDay: number;
}

export interface DueSelection<T> {
  readonly queue: readonly T[];
  readonly heldBackNew: number;
  readonly heldBackReviews: number;
}

/** Core first — the material worth the most review budget leads the session. */
const TIER_RANK: Readonly<Record<Tier, number>> = { core: 0, standard: 1, optional: 2 };

export function selectDue<T extends Schedulable>(
  cards: readonly T[],
  today: string,
  limits: DailyLimits,
): DueSelection<T> {
  const dueToday = cards.filter((card) => isDue(card.review, today));
  const reviews = dueToday.filter(isSeen).sort(byUrgency);
  const fresh = dueToday.filter((card) => !isSeen(card)).sort(byUrgency);

  return {
    queue: [...reviews.slice(0, limits.reviewsPerDay), ...fresh.slice(0, limits.newPerDay)],
    heldBackReviews: Math.max(0, reviews.length - limits.reviewsPerDay),
    heldBackNew: Math.max(0, fresh.length - limits.newPerDay),
  };
}

function isSeen(card: Schedulable): boolean {
  return card.review.interval > 0;
}

/**
 * Core before standard before optional, and within a tier the longest-overdue
 * first. Ordering has to happen before the cap, or the cap keeps an arbitrary
 * slice of the backlog and the cards that matter never surface.
 */
function byUrgency(a: Schedulable, b: Schedulable): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.review.due.localeCompare(b.review.due);
}
