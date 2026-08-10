/**
 * Cram mode: temporary, deadline-scoped focus on a topic.
 *
 * Cram is app state, not vault state — tier is a durable property of the
 * material, cram is a transient property of the user. It applies as a clamp on
 * top of whatever the scheduler returns, the same shape as `tierGrowth`, so it
 * should survive swapping the scheduler for FSRS.
 *
 * There can be several at once — an exam week is the ordinary case, not the
 * exotic one — and their scopes may overlap. Where two apply to the same card
 * the **earlier deadline governs**, which needs no precedence rule of its own:
 * the card has to be ready for the first exam that asks for it, so taking the
 * tightest clamp is simply what the dates already say. When that exam passes,
 * the next one takes over on its own.
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
  topicTags: readonly string[],
  /** Empty when no exam is configured at all — the usual case. */
  crams: readonly CramState[],
  today: string,
): number {
  const cram = governingCram(topicTags, crams, today);
  if (!cram) return interval;

  const daysLeft = daysBetween(today, cram.examDate);
  const cap = Math.max(MINIMUM_INTERVAL, Math.floor(daysLeft * RUNWAY_FRACTION));
  return Math.min(interval, cap);
}

/**
 * The exam this card is next needed for, or null if none is.
 *
 * The soonest of the ones in scope, because that is the one it has to be ready
 * for. Anything already past its date is not in the running: the date is the
 * off-switch, with no reset step.
 */
export function governingCram(
  topicTags: readonly string[],
  crams: readonly CramState[],
  today: string,
): CramState | null {
  const applies = crams.filter(
    (cram) =>
      daysBetween(today, cram.examDate) > 0 &&
      topicTags.some((tag) => isWithinScope(tag, cram.scope)),
  );
  return applies.reduce<CramState | null>(
    (soonest, cram) => (!soonest || cram.examDate < soonest.examDate ? cram : soonest),
    null,
  );
}

/** Whether any running exam claims this card. */
export function isCrammed(
  topicTags: readonly string[],
  crams: readonly CramState[],
  today: string,
): boolean {
  return governingCram(topicTags, crams, today) !== null;
}

/** The exams still ahead, soonest first — what the screens count down. */
export function runningCrams(crams: readonly CramState[], today: string): readonly CramState[] {
  return [...crams]
    .filter((cram) => daysBetween(today, cram.examDate) > 0)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));
}

/** What the countdown actually looks like: how far along, and what the pace must be. */
export interface CramPlan {
  /** Which exam this is — the screens show several at once. */
  readonly scope: string;
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
  /** New cards a day needed to meet the whole topic in time. Genuinely per day. */
  readonly requiredPerDay: number;
  /** What the user set as their pace, per session. */
  readonly targetPerSession: number;
  /**
   * Whether that pace still gets there — **assuming one session a day**, which
   * is what makes the two figures comparable. Falling behind therefore has two
   * cures, and the UI offers both: raise the pace, or sit more than one session.
   */
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
export function cramPlans(
  cards: readonly Countable[],
  crams: readonly CramState[],
  minPasses: number,
  today: string,
): readonly CramPlan[] {
  return runningCrams(crams, today).map((cram) => planFor(cards, cram, minPasses, today));
}

/**
 * One exam's state.
 *
 * A card inside two exams' scopes counts towards both, rather than only the one
 * governing its schedule: each bar answers "how much of *this* exam's material
 * have I met", and the card genuinely is part of both. The overlap means the two
 * required paces are not additive, which is the truth — one card serves both.
 */
function planFor(
  cards: readonly Countable[],
  cram: CramState,
  minPasses: number,
  today: string,
): CramPlan {
  const daysLeft = daysBetween(today, cram.examDate);
  const inScope = cards.filter((card) =>
    card.topicTags.some((tag) => isWithinScope(tag, cram.scope)),
  );
  const met = inScope.filter((card) => card.review.interval > 0).length;
  const remaining = inScope.length - met;
  const usableDays = Math.max(0, daysLeft - minPasses + 2);
  const requiredPerDay = perDayFor(remaining, usableDays);

  return {
    scope: cram.scope,
    daysLeft,
    total: inScope.length,
    met,
    progress: inScope.length === 0 ? 1 : met / inScope.length,
    remaining,
    usableDays,
    requiredPerDay,
    targetPerSession: cram.perSession,
    onTrack: requiredPerDay <= cram.perSession,
  };
}

/** With no usable days left the whole remainder falls on today, which is the honest number. */
function perDayFor(remaining: number, usableDays: number): number {
  if (remaining === 0) return 0;
  return usableDays === 0 ? remaining : Math.ceil(remaining / usableDays);
}

/** Whether one topic tag falls under an exam's scope, itself or a subtopic. */
export function isWithinScope(tag: string, scope: string): boolean {
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
