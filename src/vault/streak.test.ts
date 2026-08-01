import { describe, expect, it } from "vitest";

import { NEVER, nextStreak, standingStreak } from "./streak.js";

describe("nextStreak", () => {
  it("extends the streak when yesterday was the last review", () => {
    expect(nextStreak(6, "2026-07-31", "2026-08-01")).toBe(7);
  });

  it("does not extend it twice in the same day", () => {
    // A second session on the same day is still one day of reviewing.
    expect(nextStreak(6, "2026-08-01", "2026-08-01")).toBe(6);
  });

  it("restarts at one after a missed day, counting today", () => {
    expect(nextStreak(6, "2026-07-29", "2026-08-01")).toBe(1);
    expect(nextStreak(0, NEVER, "2026-08-01")).toBe(1);
  });

  it("extends across a month boundary", () => {
    // The date arithmetic, not string comparison, is what makes this work.
    expect(nextStreak(3, "2026-08-31", "2026-09-01")).toBe(4);
  });
});

describe("standingStreak", () => {
  it("keeps showing a streak that is still live but not yet continued today", () => {
    expect(standingStreak(6, "2026-07-31", "2026-08-01")).toBe(6);
    expect(standingStreak(6, "2026-08-01", "2026-08-01")).toBe(6);
  });

  it("shows nothing once a day has been missed", () => {
    // Claiming a six-day streak the day after breaking it would be a lie.
    expect(standingStreak(6, "2026-07-30", "2026-08-01")).toBe(0);
  });
});
