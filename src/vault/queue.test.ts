import { describe, expect, it } from "vitest";

import { selectDue } from "./queue.js";
import type { SessionLimits, Schedulable } from "./queue.js";
import type { Tier } from "./types.js";

const TODAY = "2026-08-01";
const NO_CRAM = { cram: null, cramMinPasses: 3 };
const GENEROUS: SessionLimits = { newPerSession: 100, reviewsPerSession: 100, ...NO_CRAM };

interface TestCard extends Schedulable {
  readonly id: string;
}

function card(
  id: string,
  tier: Tier,
  due: string,
  interval = 5,
  topicTags: string[] = [],
): TestCard {
  return { id, tier, topicTags, review: { due, interval, ease: 2.5 } };
}

/** interval 0 marks a card that has never been reviewed. */
function newCard(id: string, tier: Tier, topicTags: string[] = []): TestCard {
  return card(id, tier, TODAY, 0, topicTags);
}

describe("selectDue", () => {
  it("caps a years-old backlog instead of surfacing all of it at once", () => {
    // The shape of a real vault on first import: everything scheduled in 2024.
    const backlog = Array.from({ length: 200 }, (_, index) =>
      card(`c${index}`, "standard", "2024-06-01"),
    );

    const selection = selectDue(backlog, TODAY, {
      newPerSession: 8,
      reviewsPerSession: 30,
      ...NO_CRAM,
    });

    expect(selection.queue).toHaveLength(30);
    expect(selection.heldBackReviews).toBe(170);
  });

  it("takes the most overdue cards first, so the cap keeps what matters", () => {
    const cards = [
      card("recent", "standard", "2026-07-31"),
      card("ancient", "standard", "2024-01-15"),
      card("older", "standard", "2025-03-02"),
    ];

    const selection = selectDue(cards, TODAY, {
      newPerSession: 0,
      reviewsPerSession: 2,
      ...NO_CRAM,
    });

    // Ordering has to precede the cap, or the two kept would be arbitrary.
    expect(selection.queue.map((c) => c.id)).toEqual(["ancient", "older"]);
  });

  it("leads with core, whatever the due dates say", () => {
    const cards = [
      card("optional-ancient", "optional", "2024-01-01"),
      card("core-recent", "core", "2026-07-31"),
      card("standard-old", "standard", "2025-01-01"),
    ];

    const selection = selectDue(cards, TODAY, GENEROUS);

    expect(selection.queue.map((c) => c.id)).toEqual([
      "core-recent",
      "standard-old",
      "optional-ancient",
    ]);
  });

  it("counts new cards against their own cap, not the review one", () => {
    const cards = [
      ...Array.from({ length: 5 }, (_, i) => card(`seen${i}`, "standard", "2025-01-01")),
      ...Array.from({ length: 20 }, (_, i) => newCard(`new${i}`, "standard")),
    ];

    const selection = selectDue(cards, TODAY, {
      newPerSession: 3,
      reviewsPerSession: 10,
      ...NO_CRAM,
    });

    // A backlog of reviews must not eat the day's allowance of new material.
    expect(selection.queue).toHaveLength(8);
    expect(selection.heldBackNew).toBe(17);
    expect(selection.heldBackReviews).toBe(0);
  });

  it("leaves out cards that are not due yet", () => {
    const cards = [card("today", "core", TODAY), card("tomorrow", "core", "2026-08-02")];

    const selection = selectDue(cards, TODAY, GENEROUS);

    expect(selection.queue.map((c) => c.id)).toEqual(["today"]);
  });
});

const EXAM_TAG = "#flashcards/lang/certexam";

function cramming(examDate: string, perSession = 4): SessionLimits {
  return {
    newPerSession: 2,
    reviewsPerSession: 100,
    cram: { active: true, scope: EXAM_TAG, examDate, perSession },
  };
}

describe("selectDue under a cram", () => {
  it("puts the crammed topic on its own pace instead of the ordinary ceiling", () => {
    const cards = Array.from({ length: 6 }, (_, i) => newCard(`exam${i}`, "standard", [EXAM_TAG]));

    const selection = selectDue(cards, TODAY, cramming("2026-08-20"));

    // newPerSession is 2, but the exam's own pace is 4 — a deadline gets its own knob.
    expect(selection.queue).toHaveLength(4);
    expect(selection.heldCrammed).toBe(2);
  });

  it("never withholds cards for being close to the exam", () => {
    const cards = Array.from({ length: 3 }, (_, i) => newCard(`exam${i}`, "standard", [EXAM_TAG]));

    // The exam is tomorrow: too close to learn these properly, but that is the
    // learner's call to make. The app reports the pace; it does not ration.
    const selection = selectDue(cards, TODAY, cramming("2026-08-02"));

    expect(selection.queue).toHaveLength(3);
    expect(selection.heldCrammed).toBe(0);
  });

  it("keeps the crammed pace separate from every other topic's cap", () => {
    const cards = [
      ...Array.from({ length: 6 }, (_, i) => newCard(`exam${i}`, "standard", [EXAM_TAG])),
      ...Array.from({ length: 5 }, (_, i) => newCard(`other${i}`, "standard", ["#flashcards/git"])),
    ];

    const selection = selectDue(cards, TODAY, cramming("2026-08-20"));

    // Crammed cards lead, four of them at the cram's pace, then two on newPerSession.
    expect(selection.queue.map((c) => c.id)).toEqual([
      "exam0",
      "exam1",
      "exam2",
      "exam3",
      "other0",
      "other1",
    ]);
    expect(selection.heldCrammed).toBe(2);
    expect(selection.heldBackNew).toBe(3);
  });

  it("goes back to the ordinary cap once the exam has passed", () => {
    const cards = Array.from({ length: 6 }, (_, i) => newCard(`exam${i}`, "standard", [EXAM_TAG]));

    const selection = selectDue(cards, TODAY, cramming("2026-07-20"));

    // The date is the off-switch: the topic loses its own pace and rejoins newPerSession.
    expect(selection.queue).toHaveLength(2);
    expect(selection.heldCrammed).toBe(0);
    expect(selection.heldBackNew).toBe(4);
  });
});
