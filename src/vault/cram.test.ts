import { describe, expect, it } from "vitest";

import { cramClamp, cramPlans, governingCram, isCrammed } from "./cram.js";
import type { Countable } from "./cram.js";
import type { CramState } from "./types.js";

const EXAM_TAG = "#flashcards/lang/certexam";

const cram: CramState = {
  scope: EXAM_TAG,
  examDate: "2026-09-01",
  perSession: 10,
};

/** The list form every entry point now takes. */
const exams: CramState[] = [cram];

describe("cramClamp", () => {
  it("caps an interval that would otherwise schedule past the exam", () => {
    const twentyDaysBefore = "2026-08-12";
    const daysToExam = 20;

    const clamped = cramClamp(30, [EXAM_TAG], exams, twentyDaysBefore);

    // The invariant: a crammed card is always seen again before the exam.
    expect(clamped).toBeLessThanOrEqual(daysToExam);
    // The current runway fraction of 0.4 puts it at floor(20 * 0.4).
    expect(clamped).toBe(8);
  });

  it("stops clamping once the exam has passed, without the cram being turned off", () => {
    const dayAfterTheExam = "2026-09-02";

    // The exam is still configured — the date alone ends the clamp, so there
    // is no reset step the user can forget.
    expect(cramClamp(30, [EXAM_TAG], exams, dayAfterTheExam)).toBe(30);
  });

  it("leaves topics outside the cram scope alone, including the scope's own parent", () => {
    const duringTheCram = "2026-08-12";

    expect(cramClamp(30, ["#flashcards/shell"], exams, duringTheCram)).toBe(30);
    // Cramming a subtopic must not drag its broader parent topic in with it.
    expect(cramClamp(30, ["#flashcards/lang"], exams, duringTheCram)).toBe(30);
  });

  it("leaves intervals alone when no exam is configured", () => {
    // Same tag and same date that clamped 30 down to 8 above — only the list differs.
    expect(cramClamp(30, [EXAM_TAG], [], "2026-08-12")).toBe(30);
  });
});

function inScope(count: number, met: boolean): Countable[] {
  return Array.from({ length: count }, () => ({
    topicTags: [EXAM_TAG],
    review: { interval: met ? 5 : 0 },
  }));
}

describe("cramPlans", () => {
  it("works out the pace from the days that can still start new material", () => {
    // 20 unseen cards, 11 days out, 3 passes each.
    const plan = cramPlans(inScope(20, false), exams, 3, "2026-08-21")[0];

    // Not 20/11: a card begun on the last two days cannot get three looks, so
    // counting those days would understate what today actually costs.
    expect(plan?.daysLeft).toBe(11);
    expect(plan?.usableDays).toBe(10);
    expect(plan?.requiredPerDay).toBe(2);
  });

  it("says the pace is short when the chosen one will not finish in time", () => {
    const gentle: CramState = { ...cram, perSession: 3 };

    const plan = cramPlans(inScope(60, false), [gentle], 3, "2026-08-25")[0];

    // 60 cards, 7 days left, 6 usable → 10 a day. Chosen pace is 3.
    expect(plan?.requiredPerDay).toBe(10);
    expect(plan?.targetPerSession).toBe(3);
    expect(plan?.onTrack).toBe(false);
  });

  it("reports progress as the share of the topic already met", () => {
    const cards = [...inScope(3, true), ...inScope(1, false)];

    const plan = cramPlans(cards, exams, 3, "2026-08-21")[0];

    expect(plan?.met).toBe(3);
    expect(plan?.total).toBe(4);
    expect(plan?.progress).toBe(0.75);
    expect(plan?.remaining).toBe(1);
  });

  it("asks for nothing more once every card has been started", () => {
    const plan = cramPlans(inScope(12, true), exams, 3, "2026-08-21")[0];

    expect(plan?.remaining).toBe(0);
    expect(plan?.requiredPerDay).toBe(0);
    expect(plan?.onTrack).toBe(true);
  });

  it("puts the whole remainder on today once no day can still start a card", () => {
    // The exam is tomorrow, so there is no day left that fits three passes.
    const plan = cramPlans(inScope(5, false), exams, 3, "2026-08-31")[0];

    expect(plan?.usableDays).toBe(0);
    // Reported honestly rather than as an impossible-to-read infinity.
    expect(plan?.requiredPerDay).toBe(5);
    expect(plan?.onTrack).toBe(true);
  });

  it("drops out of the list entirely once the exam has passed", () => {
    expect(cramPlans(inScope(5, false), exams, 3, "2026-09-02")).toEqual([]);
  });

  it("has nothing to report when no exam is configured", () => {
    expect(cramPlans(inScope(5, false), [], 3, "2026-08-21")).toEqual([]);
  });
});

describe("isCrammed", () => {
  it("claims a card only while an exam that wants it is still ahead", () => {
    expect(isCrammed([EXAM_TAG], exams, "2026-08-12")).toBe(true);
    expect(isCrammed(["#flashcards/git"], exams, "2026-08-12")).toBe(false);
    // The day of the exam is already too late to be got ready for, and the day
    // after is the off-switch — the same boundary the clamp reads.
    expect(isCrammed([EXAM_TAG], exams, "2026-09-01")).toBe(false);
  });
});

describe("several exams at once", () => {
  const ANGULAR = "#flashcards/Angular";
  const week: CramState[] = [
    { scope: EXAM_TAG, examDate: "2026-09-01", perSession: 10 },
    { scope: ANGULAR, examDate: "2026-09-03", perSession: 4 },
  ];

  it("clamps each topic against its own deadline", () => {
    // 20 days to the first, 22 to the second.
    expect(cramClamp(30, [EXAM_TAG], week, "2026-08-12")).toBe(8);
    expect(cramClamp(30, [ANGULAR], week, "2026-08-12")).toBe(8);
    // Same fraction, different runway: 22 days out gives floor(22 * 0.4).
    expect(cramClamp(30, [ANGULAR], week, "2026-08-10")).toBe(9);
  });

  it("lets the sooner exam govern a card both of them want", () => {
    const overlap = [EXAM_TAG, ANGULAR];

    // Nine days to the first exam, eleven to the second. The card has to be
    // ready for the first, so that is the cap it gets — no precedence rule
    // needed beyond the dates.
    expect(governingCram(overlap, week, "2026-08-23")?.examDate).toBe("2026-09-01");
    expect(cramClamp(30, overlap, week, "2026-08-23")).toBe(3);
  });

  it("hands a shared card to the next exam once the first is sat", () => {
    const overlap = [EXAM_TAG, ANGULAR];

    // The day after the first exam, without anything being turned off.
    expect(governingCram(overlap, week, "2026-09-02")?.examDate).toBe("2026-09-03");
  });

  it("reports a countdown per exam, soonest first", () => {
    const cards: Countable[] = [
      { topicTags: [EXAM_TAG], review: { interval: 0 } },
      { topicTags: [ANGULAR], review: { interval: 5 } },
    ];

    const plans = cramPlans(cards, week, 3, "2026-08-25");

    expect(plans.map((plan) => plan.scope)).toEqual([EXAM_TAG, ANGULAR]);
    expect(plans[0]?.met).toBe(0);
    expect(plans[1]?.met).toBe(1);
  });

  it("counts a shared card towards both exams, because it belongs to both", () => {
    const shared: Countable[] = [{ topicTags: [EXAM_TAG, ANGULAR], review: { interval: 0 } }];

    const plans = cramPlans(shared, week, 3, "2026-08-25");

    expect(plans.map((plan) => plan.total)).toEqual([1, 1]);
  });
});
