import { describe, expect, it } from "vitest";

import { cardStanding, tallyStandings } from "./standing.js";

const TODAY = "2026-08-22";

describe("cardStanding", () => {
  it("is new when the card has never been graded, whatever its due date says", () => {
    const unseen = { due: TODAY, interval: 0, ease: 2.3 };

    expect(cardStanding(unseen, TODAY)).toEqual({ kind: "new" });
  });

  it("is overdue by the whole number of days since its due date", () => {
    const imported = { due: "2024-04-14", interval: 10, ease: 2.7 };

    expect(cardStanding(imported, TODAY)).toEqual({ kind: "overdue", days: 860 });
  });

  it("is due, not overdue by nothing, on the day it comes round", () => {
    const arrived = { due: TODAY, interval: 4, ease: 2.6 };

    expect(cardStanding(arrived, TODAY)).toEqual({ kind: "due" });
  });

  /**
   * The queue serves nothing scheduled ahead, so this should never reach a card
   * header. Naming it is the point: shown as "due today" it would be invisible.
   */
  it("is ahead by the days remaining when it is scheduled into the future", () => {
    const waiting = { due: "2026-08-29", interval: 7, ease: 2.5 };

    expect(cardStanding(waiting, TODAY)).toEqual({ kind: "ahead", days: 7 });
  });
});

describe("tallyStandings", () => {
  it("counts each kind, so a session can be described before it is started", () => {
    const cards = [
      { review: { due: TODAY, interval: 0, ease: 2.3 } },
      { review: { due: "2026-08-01", interval: 0, ease: 2.3 } },
      { review: { due: TODAY, interval: 4, ease: 2.6 } },
      { review: { due: "2026-08-20", interval: 3, ease: 2.5 } },
      { review: { due: "2026-08-29", interval: 7, ease: 2.5 } },
    ];

    expect(tallyStandings(cards, TODAY)).toEqual({ fresh: 2, due: 1, overdue: 1, ahead: 1 });
  });
});
