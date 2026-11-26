import { describe, expect, it } from "vitest";

import { practiceQueue } from "./practice.js";
import type { Schedulable } from "./queue.js";

const TODAY = "2026-08-01";

interface Card extends Schedulable {
  readonly name: string;
}

function card(name: string, due: string, interval: number, ease: number, pair?: string): Card {
  return {
    name,
    tier: "standard",
    topicTags: ["#flashcards/lang/generics"],
    review: { due, interval, ease },
    ...(pair === undefined ? {} : { pair }),
  };
}

describe("practiceQueue", () => {
  /**
   * Due and never-met cards are left out because an ordinary session already
   * serves them. Of a reversed pair only one direction comes, since the other's
   * answer would have just been on screen.
   */
  it("serves only cards met and not yet due, weakest first, one direction per pair", () => {
    const cards = [
      card("sturdy", "2026-08-20", 20, 2.6),
      card("due today", TODAY, 5, 1.4),
      card("never met", TODAY, 0, 2.3),
      card("shaky", "2026-08-05", 4, 1.8),
      card("shaky reversed", "2026-08-05", 4, 1.8, "wildcards"),
      card("shaky forward", "2026-08-04", 4, 1.8, "wildcards"),
    ];

    const served = practiceQueue(cards, TODAY, 10).map((each) => each.name);

    expect(served).toEqual(["shaky forward", "shaky", "sturdy"]);
  });
});
