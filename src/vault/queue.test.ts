import { describe, expect, it } from "vitest";

import { selectDue } from "./queue.js";
import type { DailyLimits, Schedulable } from "./queue.js";
import type { Tier } from "./types.js";

const TODAY = "2026-08-01";
const GENEROUS: DailyLimits = { newPerDay: 100, reviewsPerDay: 100 };

interface TestCard extends Schedulable {
  readonly id: string;
}

function card(id: string, tier: Tier, due: string, interval = 5): TestCard {
  return { id, tier, review: { due, interval, ease: 2.5 } };
}

/** interval 0 marks a card that has never been reviewed. */
function newCard(id: string, tier: Tier): TestCard {
  return card(id, tier, TODAY, 0);
}

describe("selectDue", () => {
  it("caps a years-old backlog instead of surfacing all of it at once", () => {
    // The shape of a real vault on first import: everything scheduled in 2024.
    const backlog = Array.from({ length: 200 }, (_, index) =>
      card(`c${index}`, "standard", "2024-06-01"),
    );

    const selection = selectDue(backlog, TODAY, { newPerDay: 8, reviewsPerDay: 30 });

    expect(selection.queue).toHaveLength(30);
    expect(selection.heldBackReviews).toBe(170);
  });

  it("takes the most overdue cards first, so the cap keeps what matters", () => {
    const cards = [
      card("recent", "standard", "2026-07-31"),
      card("ancient", "standard", "2024-01-15"),
      card("older", "standard", "2025-03-02"),
    ];

    const selection = selectDue(cards, TODAY, { newPerDay: 0, reviewsPerDay: 2 });

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

    const selection = selectDue(cards, TODAY, { newPerDay: 3, reviewsPerDay: 10 });

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
