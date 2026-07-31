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
});

describe("tierGrowth", () => {
  it("collapses every tier to the same growth when core emphasis is off", () => {
    expect(tierGrowth("core", 0)).toBe(1);
    expect(tierGrowth("standard", 0)).toBe(1);
    expect(tierGrowth("optional", 0)).toBe(1);
  });
});