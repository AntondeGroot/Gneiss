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
  cram: CramState,
  today: string,
): number {
  if (!cram.active) return interval;
  if (!topicTags.some((tag) => isWithinScope(tag, cram.scope))) return interval;

  const daysLeft = daysBetween(today, cram.examDate);
  if (daysLeft <= 0) return interval;

  const cap = Math.max(MINIMUM_INTERVAL, Math.floor(daysLeft * RUNWAY_FRACTION));
  return Math.min(interval, cap);
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