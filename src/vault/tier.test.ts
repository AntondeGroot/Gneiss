import { describe, expect, it } from "vitest";

import { resolveTier, tierGrowth } from "./tier.js";
import type { ParsedNote, Tier, TierMapping } from "./types.js";

function noteTagged(topicTags: string[], tierOverride?: Tier): ParsedNote {
  return {
    note: "example.md",
    cards: [],
    topicTags,
    ...(tierOverride ? { tierOverride } : {}),
  };
}

describe("resolveTier", () => {
  it("lets a per-note tier tag outrank the tag mapping", () => {
    const mapping: TierMapping = { "#flashcards/lang": "optional" };

    expect(resolveTier(noteTagged(["#flashcards/lang"], "core"), mapping)).toBe("core");
  });

  it("picks the most specific mapped tag when a note carries a topic and its subtopic", () => {
    const mapping: TierMapping = {
      "#flashcards/lang": "core",
      "#flashcards/lang/certexam": "optional",
    };
    const note = noteTagged(["#flashcards/lang", "#flashcards/lang/certexam"]);

    expect(resolveTier(note, mapping)).toBe("optional");
  });

  it("falls back to standard when the note matches no mapping row", () => {
    const mapping: TierMapping = { "#flashcards/lang": "core" };

    expect(resolveTier(noteTagged(["#flashcards/shell"]), mapping)).toBe("standard");
  });
});

describe("tierGrowth", () => {
  it("collapses every tier to the same growth when core emphasis is off", () => {
    expect(tierGrowth("core", 0)).toBe(1);
    expect(tierGrowth("standard", 0)).toBe(1);
    expect(tierGrowth("optional", 0)).toBe(1);
  });

  it("shortens core intervals and lengthens optional ones as emphasis rises", () => {
    const core = tierGrowth("core", 1);
    const standard = tierGrowth("standard", 1);
    const optional = tierGrowth("optional", 1);

    // Asserted as an ordering, not exact values: the 0.45 / 0.80 constants are
    // tunable, but core resurfacing sooner than optional is the whole premise.
    expect(core).toBeLessThan(standard);
    expect(standard).toBeLessThan(optional);
  });
});
