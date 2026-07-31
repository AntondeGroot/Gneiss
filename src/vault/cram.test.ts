import { describe, expect, it } from "vitest";

import { cramClamp } from "./cram.js";
import type { CramState } from "./types.js";

const EXAM_TAG = "#flashcards/lang/certexam";

const cram: CramState = {
  active: true,
  scope: EXAM_TAG,
  examDate: "2026-09-01",
};

describe("cramClamp", () => {
  it("caps an interval that would otherwise schedule past the exam", () => {
    const twentyDaysBefore = "2026-08-12";
    const daysToExam = 20;

    const clamped = cramClamp(30, [EXAM_TAG], cram, twentyDaysBefore);

    // The invariant: a crammed card is always seen again before the exam.
    expect(clamped).toBeLessThanOrEqual(daysToExam);
    // The current runway fraction of 0.4 puts it at floor(20 * 0.4).
    expect(clamped).toBe(8);
  });

  it("stops clamping once the exam has passed, without the cram being turned off", () => {
    const dayAfterTheExam = "2026-09-02";

    // `cram.active` is still true — the date alone ends the clamp, so there is
    // no reset step the user can forget.
    expect(cramClamp(30, [EXAM_TAG], cram, dayAfterTheExam)).toBe(30);
  });

  it("leaves topics outside the cram scope alone, including the scope's own parent", () => {
    const duringTheCram = "2026-08-12";

    expect(cramClamp(30, ["#flashcards/shell"], cram, duringTheCram)).toBe(30);
    // Cramming a subtopic must not drag its broader parent topic in with it.
    expect(cramClamp(30, ["#flashcards/lang"], cram, duringTheCram)).toBe(30);
  });
});