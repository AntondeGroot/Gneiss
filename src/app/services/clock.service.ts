import { DestroyRef, Injectable, inject, signal } from "@angular/core";

/**
 * A timer asked to fire on the stroke of midnight can arrive a hair early, and
 * would then read the day it was meant to end. A second's grace costs nothing.
 */
const SETTLE_MS = 1000;

/**
 * What day it is — as something that can change while the app is open.
 *
 * Two things were wrong with reading the date at the point of use. It was the
 * **UTC** date, so anywhere east of Greenwich the app kept yesterday's date for
 * hours after local midnight: in Amsterdam in summer the day rolled at 02:00,
 * and a review at 00:30 counted towards the day before. And it was a plain
 * function call inside `computed()`s, which only recompute when a *signal* they
 * read changes — so nothing noticed a rollover at all. An app left open
 * overnight served the previous day's queue in the morning.
 *
 * The signal is why this is a service and not a function: something has to own
 * the tick. `today()` stays a function for the one-shot reads that only ever
 * want the date right now.
 */
@Injectable({ providedIn: "root" })
export class ClockService {
  private readonly day = signal(today());

  /** The local calendar day as `YYYY-MM-DD`, and a dependency worth having. */
  readonly today = this.day.asReadonly();

  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.tickAtMidnight();
    // A sleeping phone does not run timers, so the tick alone would arrive late
    // or not at all. Coming back to the app is the other moment the date can
    // have moved, and the one that covers being backgrounded overnight.
    document.addEventListener("visibilitychange", this.sync);
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Setting the same date is not a change, so syncing mid-day costs nothing. */
  private readonly sync = (): void => {
    this.day.set(today());
  };

  private tickAtMidnight(): void {
    this.timer = setTimeout(() => {
      this.sync();
      this.tickAtMidnight();
    }, millisUntilNextDay(new Date()));
  }

  private stop(): void {
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.sync);
  }
}

/** Today as the calendar on the wall has it, not as UTC does. */
export function today(): string {
  return localDate(new Date());
}

/**
 * An instant as its local calendar day.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is the UTC day and is a
 * different date from local for part of every day.
 */
export function localDate(at: Date): string {
  return `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
}

/**
 * How long until the local day rolls over.
 *
 * Built by asking for day + 1 rather than by adding 24 hours: the constructor
 * normalises a month or year end, and lands on real local midnight on the two
 * nights a year that are not 24 hours long.
 */
export function millisUntilNextDay(at: Date): number {
  const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
  return midnight.getTime() - at.getTime() + SETTLE_MS;
}

function twoDigits(part: number): string {
  return `${part}`.padStart(2, "0");
}
