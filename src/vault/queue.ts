/**
 * Choosing what to review in one sitting.
 *
 * An existing vault arrives with a backlog: notes scheduled years ago are all
 * overdue at once. Nothing is rescheduled to hide that — those cards really are
 * due — but a session is portioned rather than served whole, since hundreds of
 * cards at once is how an SRS gets abandoned.
 *
 * These limits size a **session, not a day**. Grading a card schedules it
 * forward, so it leaves the due set and the next one takes its place: finishing
 * a session and starting another walks straight through the backlog. That is
 * deliberate — the figure is a sensible portion, not a lockout.
 *
 * A cram replaces the new-card portion for its own topic with a pace the user
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

export interface SessionLimits {
  /** How many never-seen cards one session takes on. */
  readonly newPerSession: number;
  /** How many cards already in rotation one session takes on — the backlog's portion. */
  readonly reviewsPerSession: number;
  /** Null when no cram is configured at all — the usual case. */
  readonly cram: CramState | null;
}

export interface DueSelection<T> {
  readonly queue: readonly T[];
  readonly heldBackNew: number;
  readonly heldBackReviews: number;
  /**
   * Unseen cards in the cram's topic beyond this session's pace. Counted apart
   * from `heldBackNew` so the UI can pair it with the pace the deadline demands,
   * rather than reporting it as the ordinary portion.
   */
  readonly heldCrammed: number;
}

/** Core first — the material worth the most review budget leads the session. */
const TIER_RANK: Readonly<Record<Tier, number>> = { core: 0, standard: 1, optional: 2 };

export function selectDue<T extends Schedulable>(
  cards: readonly T[],
  today: string,
  limits: SessionLimits,
): DueSelection<T> {
  const dueToday = cards.filter((card) => isDue(card.review, today));
  const reviews = dueToday.filter(isSeen).sort(byUrgency);
  const fresh = dueToday.filter((card) => !isSeen(card)).sort(byUrgency);

  const crammed = fresh.filter((card) => isCrammed(card.topicTags, runningCram(limits, today)));
  const rest = fresh.filter((card) => !isCrammed(card.topicTags, runningCram(limits, today)));

  const room = share(reviews.length, rest.length, limits);
  const cram = cappedAt(crammed, limits.cram?.perSession ?? limits.newPerSession);

  return {
    // Crammed cards lead: they are the ones with a deadline attached.
    queue: [...cram.queue, ...reviews.slice(0, room.reviews), ...rest.slice(0, room.fresh)],
    heldBackReviews: reviews.length - room.reviews,
    heldBackNew: rest.length - room.fresh,
    heldCrammed: cram.heldBackNew,
  };
}

/**
 * How many reviews and how many new cards a session serves.
 *
 * The two figures are a *budget*, not two separate ceilings: whichever pool is
 * short gives its room to the other, so a session is a consistent size instead
 * of collapsing on the days one side has run dry. Fifteen reviews and five new
 * is twenty either way — twenty reviews when nothing is new, twenty new when
 * nothing is due.
 *
 * Neither side is ever padded beyond what exists, so the total simply shrinks
 * when the whole deck is small.
 */
function share(
  reviews: number,
  fresh: number,
  limits: SessionLimits,
): { reviews: number; fresh: number } {
  const budget = limits.reviewsPerSession + limits.newPerSession;
  let takeReviews = Math.min(limits.reviewsPerSession, reviews);
  let takeFresh = Math.min(limits.newPerSession, fresh);

  // Room neither pool claimed, offered to whichever still has cards waiting.
  const spare = budget - takeReviews - takeFresh;
  if (spare > 0) {
    takeReviews += Math.min(spare, reviews - takeReviews);
    takeFresh += Math.min(budget - takeReviews - takeFresh, fresh - takeFresh);
  }

  return { reviews: takeReviews, fresh: takeFresh };
}

/**
 * The cram, if one is running today.
 *
 * Null once the date has passed, so the topic quietly rejoins the ordinary
 * pools — the date is the off-switch, with no reset step.
 */
function runningCram(limits: SessionLimits, today: string): CramState | null {
  if (!limits.cram?.active) return null;
  return daysBetween(today, limits.cram.examDate) > 0 ? limits.cram : null;
}

function cappedAt<T>(cards: readonly T[], limit: number): { queue: T[]; heldBackNew: number } {
  return {
    queue: cards.slice(0, limit),
    heldBackNew: Math.max(0, cards.length - limit),
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
