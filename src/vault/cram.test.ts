import { describe, expect, it } from "vitest";

import { cramClamp, cramPlan } from "./cram.js";
import type { Countable } from "./cram.js";
import type { CramState } from "./types.js";

const EXAM_TAG = "#flashcards/lang/certexam";

const cram: CramState = {
  active: true,
  scope: EXAM_TAG,
  examDate: "2026-09-01",
  perSession: 10,
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

  it("leaves intervals alone while no cram is active", () => {
    const noCram: CramState = { ...cram, active: false };

    // Same tag and same date that clamped 30 down to 8 above — only the flag differs.
    expect(cramClamp(30, [EXAM_TAG], noCram, "2026-08-12")).toBe(30);
  });
});

function inScope(count: number, met: boolean): Countable[] {
  return Array.from({ length: count }, () => ({
    topicTags: [EXAM_TAG],
    review: { interval: met ? 5 : 0 },
  }));
}

describe("cramPlan", () => {
  it("works out the pace from the days that can still start new material", () => {
    // 20 unseen cards, 11 days out, 3 passes each.
    const plan = cramPlan(inScope(20, false), cram, 3, "2026-08-21");

    // Not 20/11: a card begun on the last two days cannot get three looks, so
    // counting those days would understate what today actually costs.
    expect(plan?.daysLeft).toBe(11);
    expect(plan?.usableDays).toBe(10);
    expect(plan?.requiredPerDay).toBe(2);
  });

  it("says the pace is short when the chosen one will not finish in time", () => {
    const gentle: CramState = { ...cram, perSession: 3 };

    const plan = cramPlan(inScope(60, false), gentle, 3, "2026-08-25");

    // 60 cards, 7 days left, 6 usable → 10 a day. Chosen pace is 3.
    expect(plan?.requiredPerDay).toBe(10);
    expect(plan?.targetPerSession).toBe(3);
    expect(plan?.onTrack).toBe(false);
  });

  it("reports progress as the share of the topic already met", () => {
    const cards = [...inScope(3, true), ...inScope(1, false)];

    const plan = cramPlan(cards, cram, 3, "2026-08-21");

    expect(plan?.met).toBe(3);
    expect(plan?.total).toBe(4);
    expect(plan?.progress).toBe(0.75);
    expect(plan?.remaining).toBe(1);
  });

  it("asks for nothing more once every card has been started", () => {
    const plan = cramPlan(inScope(12, true), cram, 3, "2026-08-21");

    expect(plan?.remaining).toBe(0);
    expect(plan?.requiredPerDay).toBe(0);
    expect(plan?.onTrack).toBe(true);
  });

  it("puts the whole remainder on today once no day can still start a card", () => {
    // The exam is tomorrow, so there is no day left that fits three passes.
    const plan = cramPlan(inScope(5, false), cram, 3, "2026-08-31");

    expect(plan?.usableDays).toBe(0);
    // Reported honestly rather than as an impossible-to-read infinity.
    expect(plan?.requiredPerDay).toBe(5);
    expect(plan?.onTrack).toBe(true);
  });

  it("reads as no plan at all once the exam has passed", () => {
    expect(cramPlan(inScope(5, false), cram, 3, "2026-09-02")).toBeNull();
    expect(cramPlan(inScope(5, false), { ...cram, active: false }, 3, "2026-08-21")).toBeNull();
  });
});
