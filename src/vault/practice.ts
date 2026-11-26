/**
 * Practising a topic ahead of its schedule.
 *
 * The queue only ever serves what is due, which is right for keeping a deck
 * alive and wrong for the topic someone *knows* is weak: if nothing in it is due
 * today, an ordinary session has nothing to offer. Practice serves the cards
 * that are not due yet, weakest first.
 *
 * What grading one of them does is decided in `schedule`, not here: a card
 * answered early can be brought closer, never pushed further away.
 */

import { oneDirectionEach } from "./queue.js";
import type { Schedulable } from "./queue.js";
import { isDue } from "./schedule.js";

/**
 * Up to `size` cards met before and not yet due, lowest ease first.
 *
 * Ease is where forgetting leaves its mark, so it leads; among cards equally
 * hard, the one due soonest is the one closest to being forgotten. New cards
 * are never here — a card not yet met is always due, so an ordinary session
 * already serves it.
 */
export function practiceQueue<T extends Schedulable>(
  cards: readonly T[],
  today: string,
  size: number,
): T[] {
  const ahead = cards.filter((card) => card.review.interval > 0 && !isDue(card.review, today));
  ahead.sort(byWeakness);
  return oneDirectionEach(ahead).slice(0, size);
}

function byWeakness(a: Schedulable, b: Schedulable): number {
  return a.review.ease - b.review.ease || a.review.due.localeCompare(b.review.due);
}
