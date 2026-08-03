/**
 * Choosing what to review today.
 *
 * An existing vault arrives with a backlog: notes scheduled years ago are all
 * overdue at once. Nothing is rescheduled to hide that — those cards really are
 * due — but the day's queue is capped so the backlog drains over time instead of
 * presenting hundreds of cards in one session, which is how an SRS gets abandoned.
 *
 * A cram replaces the new-card ceiling for its own topic with a pace the user
 * sets. Nothing is ever withheld on the grounds that it is "too late to learn" —
 * whether the pace is fast enough is reported by `cramPlan`, not enforced here.
 */

import { daysBetween, isCrammed } from "./cram.js";
import { isDue } from "./schedule.js";
import type { CramState, ReviewState, Tier } from "./types.js";

/** The minimum a card needs for the queue to order and count it. */
export interface Schedulable {
  readonly tier: Tier;
  readonly topicTags: readonly string[];
  readonly review: ReviewState;
}

export interface DailyLimits {
  /** Ceiling on cards never seen before. */
  readonly newPerDay: number;
  /** Ceiling on cards already in rotation, which is what a backlog fills. */
  readonly reviewsPerDay: number;
  /** Null when no cram is configured at all — the usual case. */
  readonly cram: CramState | null;
}

export interface DueSelection<T> {
  readonly queue: readonly T[];
  readonly heldBackNew: number;
  readonly heldBackReviews: number;
  /**
   * Unseen cards in the cram's topic beyond today's pace. Counted apart from
   * `heldBackNew` so the UI can pair it with the pace the deadline demands,
   * rather than reporting it as the ordinary daily ceiling.
   */
  readonly heldCrammed: number;
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
  const introduced = admitNew(fresh, today, limits);

  return {
    queue: [...reviews.slice(0, limits.reviewsPerDay), ...introduced.queue],
    heldBackReviews: Math.max(0, reviews.length - limits.reviewsPerDay),
    heldBackNew: introduced.heldBackNew,
    heldCrammed: introduced.heldCrammed,
  };
}

/**
 * Which unseen cards to start today.
 *
 * A running cram takes its topic out of the ordinary ceiling and puts it on the
 * pace the user chose for that exam. Both numbers are targets for one day, not
 * verdicts on the material — anything not reached today is simply next in line.
 */
function admitNew<T extends Schedulable>(
  fresh: readonly T[],
  today: string,
  limits: DailyLimits,
): { queue: T[]; heldBackNew: number; heldCrammed: number } {
  // No cram, or one whose date has passed: nothing is special, everything queues
  // under the ordinary ceiling. The date is the off-switch, with no reset step.
  if (runningCramDaysLeft(limits, today) === null) {
    return { ...cappedAt(fresh, limits.newPerDay), heldCrammed: 0 };
  }

  const crammed: T[] = [];
  const rest: T[] = [];
  for (const card of fresh) {
    (isCrammed(card.topicTags, limits.cram) ? crammed : rest).push(card);
  }

  const cappedCram = cappedAt(crammed, limits.cram?.perDay ?? limits.newPerDay);
  const cappedRest = cappedAt(rest, limits.newPerDay);

  return {
    // Crammed cards lead: they are the ones with a deadline attached.
    queue: [...cappedCram.queue, ...cappedRest.queue],
    heldBackNew: cappedRest.heldBackNew,
    heldCrammed: cappedCram.heldBackNew,
  };
}

function cappedAt<T>(cards: readonly T[], limit: number): { queue: T[]; heldBackNew: number } {
  return {
    queue: cards.slice(0, limit),
    heldBackNew: Math.max(0, cards.length - limit),
  };
}

/** Days until the exam, or null when no cram is running — an expired one is not. */
function runningCramDaysLeft(limits: DailyLimits, today: string): number | null {
  if (!limits.cram?.active) return null;

  const daysLeft = daysBetween(today, limits.cram.examDate);
  return daysLeft > 0 ? daysLeft : null;
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
