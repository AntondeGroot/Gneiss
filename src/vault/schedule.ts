/**
 * Turning a grade into the next review.
 *
 * Deliberately simple — an SM-2 approximation, not SM-2 itself. The tier growth
 * multiplier and the cram clamp are both applied *on top* of whatever the core
 * curve returns, so swapping this for FSRS later should leave them intact.
 */

import { cramClamp } from "./cram.js";
import { tierGrowth } from "./tier.js";
import type { CramState, Grade, ReviewState, Tier } from "./types.js";

/** Ease a card starts life with, before any grading moves it. */
export const STARTING_EASE = 2.3;

const MINIMUM_EASE = 1.3;
const DIFFICULT_EASE_PENALTY = 0.2;
const MEDIUM_EASE_PENALTY = 0.02;
const EASY_EASE_BONUS = 0.1;

/** Easy multiplies harder than Medium, on top of the ease factor. */
const EASY_BOOST = 1.5;

/** Difficult sends a card back to tomorrow regardless of its history. */
const DIFFICULT_INTERVAL = 1;
const MINIMUM_INTERVAL = 1;
const MINIMUM_EASY_INTERVAL = 2;

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SchedulingOptions {
  readonly tier: Tier;
  /** Core emphasis, 0..1. At 0 every tier behaves identically. */
  readonly spread: number;
  /** ISO date the review is happening on. */
  readonly today: string;
  readonly topicTags: string[];
  /** Null when no cram is configured. */
  readonly cram: CramState | null;
}

/** The state a card carries before it has ever been reviewed. */
export function newReviewState(today: string): ReviewState {
  return { due: today, interval: 0, ease: STARTING_EASE };
}

export function schedule(
  state: ReviewState,
  grade: Grade,
  options: SchedulingOptions,
): ReviewState {
  const ease = nextEase(state.ease, grade);
  const grown = grownInterval(state.interval, ease, grade, options);
  const interval = cramClamp(grown, options.topicTags, options.cram, options.today);

  return { due: addDays(options.today, interval), interval, ease };
}

function nextEase(ease: number, grade: Grade): number {
  if (grade === "difficult") return Math.max(MINIMUM_EASE, ease - DIFFICULT_EASE_PENALTY);
  if (grade === "medium") return Math.max(MINIMUM_EASE, ease - MEDIUM_EASE_PENALTY);
  return ease + EASY_EASE_BONUS;
}

function grownInterval(
  interval: number,
  ease: number,
  grade: Grade,
  options: SchedulingOptions,
): number {
  if (grade === "difficult") return DIFFICULT_INTERVAL;

  const growth = tierGrowth(options.tier, options.spread);
  const base = Math.max(MINIMUM_INTERVAL, interval);
  if (grade === "medium") return Math.max(MINIMUM_INTERVAL, Math.round(base * ease * growth));
  return Math.max(MINIMUM_EASY_INTERVAL, Math.round(base * ease * EASY_BOOST * growth));
}

export function addDays(isoDate: string, days: number): string {
  const at = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(at)) return isoDate;
  return new Date(at + days * MILLIS_PER_DAY).toISOString().slice(0, 10);
}

/** Cards fall due when their due date is today or earlier. */
export function isDue(state: ReviewState, today: string): boolean {
  return state.due <= today;
}
