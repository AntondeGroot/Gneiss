/**
 * Cram mode: temporary, deadline-scoped focus on one topic.
 *
 * Cram is app state, not vault state — tier is a durable property of the
 * material, cram is a transient property of the user. It applies as a clamp on
 * top of whatever the scheduler returns, the same shape as `tierGrowth`, so it
 * should survive swapping the scheduler for FSRS.
 */

import type { CramState } from "./types.js";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fraction of the remaining runway a single interval may consume. */
const RUNWAY_FRACTION = 0.4;

const MINIMUM_INTERVAL = 1;

/**
 * Caps an interval so nothing schedules past the exam. As the date nears the
 * cap tightens on its own, so focus intensifies without a separate knob; once
 * the date passes the clamp stops applying and the tag reverts to its tier.
 */
export function cramClamp(
  interval: number,
  topicTags: string[],
  /** Null when no cram is configured at all — the usual case. */
  cram: CramState | null,
  today: string,
): number {
  if (!cram?.active) return interval;
  if (!topicTags.some((tag) => isWithinScope(tag, cram.scope))) return interval;

  const daysLeft = daysBetween(today, cram.examDate);
  if (daysLeft <= 0) return interval;

  const cap = Math.max(MINIMUM_INTERVAL, Math.floor(daysLeft * RUNWAY_FRACTION));
  return Math.min(interval, cap);
}

/** Whether a card's tags put it inside the cram's scope. */
export function isCrammed(topicTags: readonly string[], cram: CramState | null): boolean {
  if (!cram?.active) return false;
  return topicTags.some((tag) => isWithinScope(tag, cram.scope));
}

/** What the countdown actually looks like: how far along, and what the pace must be. */
export interface CramPlan {
  readonly daysLeft: number;
  /** Cards in scope, and how many have been met at least once. */
  readonly total: number;
  readonly met: number;
  /** Share of the scope already met, 0..1 — the progress bar. */
  readonly progress: number;
  /** Cards not yet started. */
  readonly remaining: number;
  /**
   * Days on which starting a card still leaves room for `minPasses` looks.
   * Fewer than the days left: a card begun the day before an exam is only seen,
   * not learned, so the last days cannot be counted on for new material.
   */
  readonly usableDays: number;
  /** New cards a day needed to meet the whole topic in time. */
  readonly requiredPerDay: number;
  /** What the user set as their pace. */
  readonly targetPerDay: number;
  /** Whether that pace still gets there. */
  readonly onTrack: boolean;
}

export interface Countable {
  readonly topicTags: readonly string[];
  readonly review: { readonly interval: number };
}

/**
 * The state of a cram: how much of the topic has been met, and the pace the
 * deadline demands.
 *
 * Cards are never withheld — that would treat the learner as the problem. The
 * app's job is to say what the deadline costs per day and let them decide; a
 * pace that is too slow is reported, not enforced.
 *
 * Progress counts cards *met at least once*, because that is what the vault can
 * actually tell us: the SR comment stores due, interval and ease, not a tally of
 * passes, and inventing one would break round-trip with the Obsidian plugin.
 */
export function cramPlan(
  cards: readonly Countable[],
  cram: CramState | null,
  minPasses: number,
  today: string,
): CramPlan | null {
  if (!cram?.active) return null;

  const daysLeft = daysBetween(today, cram.examDate);
  if (daysLeft <= 0) return null;

  const inScope = cards.filter((card) => isCrammed(card.topicTags, cram));
  const met = inScope.filter((card) => card.review.interval > 0).length;
  const remaining = inScope.length - met;
  const usableDays = Math.max(0, daysLeft - minPasses + 2);
  const requiredPerDay = perDayFor(remaining, usableDays);

  return {
    daysLeft,
    total: inScope.length,
    met,
    progress: inScope.length === 0 ? 1 : met / inScope.length,
    remaining,
    usableDays,
    requiredPerDay,
    targetPerDay: cram.perDay,
    onTrack: requiredPerDay <= cram.perDay,
  };
}

/** With no usable days left the whole remainder falls on today, which is the honest number. */
function perDayFor(remaining: number, usableDays: number): number {
  if (remaining === 0) return 0;
  return usableDays === 0 ? remaining : Math.ceil(remaining / usableDays);
}

function isWithinScope(tag: string, scope: string): boolean {
  const lowerTag = tag.toLowerCase();
  const lowerScope = scope.toLowerCase();
  return lowerTag === lowerScope || lowerTag.startsWith(`${lowerScope}/`);
}

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
  const to = Date.parse(`${toIsoDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / MILLIS_PER_DAY);
}
