/**
 * Consecutive-day review streak.
 *
 * Kept as a pure function of dates rather than a counter the app increments, so
 * it cannot drift: the same inputs always give the same streak, whatever order
 * devices sync in.
 */

import { addDays } from "./schedule.js";

/** No review has ever been recorded. */
export const NEVER = "";

/**
 * The streak after reviewing on `today`.
 *
 * Reviewing twice in a day does not extend it, and a missed day resets it to 1 —
 * today still counts, because you did review.
 */
export function nextStreak(current: number, lastReviewedOn: string, today: string): number {
  if (lastReviewedOn === today) return current;
  if (lastReviewedOn === addDays(today, -1)) return current + 1;
  return 1;
}

/**
 * A streak shown before reviewing today: still live if yesterday counted, but
 * already broken if the last review was older than that.
 */
export function standingStreak(current: number, lastReviewedOn: string, today: string): number {
  if (lastReviewedOn === today || lastReviewedOn === addDays(today, -1)) return current;
  return 0;
}
