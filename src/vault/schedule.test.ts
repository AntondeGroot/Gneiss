import { describe, expect, it } from "vitest";

import { isDue, newReviewState, schedule, STARTING_EASE } from "./schedule.js";
import type { SchedulingOptions } from "./schedule.js";
import type { Tier } from "./types.js";

const STANDARD: SchedulingOptions = {
  tier: "standard",
  spread: 0.8,
  today: "2026-08-01",
  topicTags: ["#flashcards/shell"],
  crams: [],
};

function at(tier: Tier): SchedulingOptions {
  return { ...STANDARD, tier };
}

describe("schedule", () => {
  it("sends a difficult card back to tomorrow however long its interval was", () => {
    const wellKnown = { due: "2026-08-01", interval: 30, ease: 2.5 };

    expect(schedule(wellKnown, "difficult", STANDARD)).toEqual({
      due: "2026-08-02",
      interval: 1,
      ease: 2.3,
    });
  });

  it("spreads the same card's next interval by tier", () => {
    const card = { due: "2026-08-01", interval: 10, ease: 2.5 };

    const core = schedule(card, "medium", at("core")).interval;
    const standard = schedule(card, "medium", at("standard")).interval;
    const optional = schedule(card, "medium", at("optional")).interval;

    // One card, one grade — only the tier differs. This is the whole premise:
    // core resurfaces far sooner than optional.
    expect(core).toBeLessThan(standard);
    expect(standard).toBeLessThan(optional);
    expect({ core, standard, optional }).toEqual({ core: 16, standard: 25, optional: 41 });
  });

  it("grows an easy card further than the same card graded medium", () => {
    const card = { due: "2026-08-01", interval: 10, ease: 2.5 };

    const medium = schedule(card, "medium", STANDARD);
    const easy = schedule(card, "easy", STANDARD);

    expect(easy.interval).toBeGreaterThan(medium.interval);
    // Easy also raises ease, where medium nudges it down.
    expect(easy.ease).toBeGreaterThan(card.ease);
    expect(medium.ease).toBeLessThan(card.ease);
  });

  it("never lets repeated failures push ease below the floor", () => {
    const fragile = { due: "2026-08-01", interval: 1, ease: 1.4 };

    const once = schedule(fragile, "difficult", STANDARD);
    const twice = schedule(once, "difficult", STANDARD);

    // Without a floor, ease would keep falling and the card could never grow
    // its interval again — permanently stuck at one day. Compared as floats:
    // the exact bits do not matter, only that the value stops descending.
    expect(once.ease).toBeCloseTo(1.3);
    expect(twice.ease).toBeCloseTo(1.3);
    expect(twice.ease).not.toBeLessThan(once.ease);
  });

  it("counts the due date forward from today, across a month boundary", () => {
    const card = { due: "2026-08-30", interval: 1, ease: 2.5 };

    const next = schedule(card, "medium", { ...STANDARD, today: "2026-08-30" });

    expect(next).toMatchObject({ interval: 2, due: "2026-09-01" });
  });

  it("clamps the interval it produced when a cram is running", () => {
    const card = { due: "2026-08-01", interval: 10, ease: 2.5 };
    const cramming: SchedulingOptions = {
      ...STANDARD,
      crams: [{ scope: "#flashcards/shell", examDate: "2026-08-11", perSession: 10 }],
    };

    const next = schedule(card, "medium", cramming);

    // Ungrammed this schedules 25 days out — past the exam. The clamp caps it at
    // 40% of the ten days remaining, and the due date follows the clamped value.
    expect(schedule(card, "medium", STANDARD).interval).toBe(25);
    expect(next).toMatchObject({ interval: 4, due: "2026-08-05" });
  });
});

describe("newReviewState and isDue", () => {
  it("starts a card due immediately, and treats due-today as due", () => {
    const fresh = newReviewState("2026-08-01");

    expect(fresh).toEqual({ due: "2026-08-01", interval: 0, ease: STARTING_EASE });
    expect(isDue(fresh, "2026-08-01")).toBe(true);
    expect(isDue({ ...fresh, due: "2026-07-31" }, "2026-08-01")).toBe(true);
    expect(isDue({ ...fresh, due: "2026-08-02" }, "2026-08-01")).toBe(false);
  });
});
