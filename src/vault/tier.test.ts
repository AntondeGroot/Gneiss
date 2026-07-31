import { describe, expect, it } from "vitest";

import { resolveTier } from "./tier.js";
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
});