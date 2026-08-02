import { describe, expect, it } from "vitest";

import { distinctTopicTags, topicTiers, withTopicTier } from "./topics.js";
import type { TierMapping } from "./types.js";

describe("topicTiers", () => {
  it("reports an unmapped subtopic as inheriting its parent's tier", () => {
    const mapping: TierMapping = { "#flashcards/lang": "core" };

    const rows = topicTiers(["#flashcards/lang", "#flashcards/lang/certexam"], mapping);

    expect(rows).toEqual([
      { tag: "#flashcards/lang", mapped: "core", effective: "core" },
      // No row of its own — so nothing to clear, but it is scheduled as core.
      { tag: "#flashcards/lang/certexam", effective: "core" },
    ]);
  });

  it("keeps a row for a mapped tag the vault no longer carries", () => {
    const mapping: TierMapping = { "#flashcards/retired": "optional" };

    const rows = topicTiers(["#flashcards/git"], mapping);

    // The row still applies to anything under it, so the table has to offer a
    // way to clear it — dropping it would leave a rule with no way back.
    expect(rows.map((row) => row.tag)).toEqual(["#flashcards/git", "#flashcards/retired"]);
  });
});

function rowFor(tag: string, mapping: TierMapping) {
  return topicTiers([tag], mapping).find((row) => row.tag === tag);
}

describe("withTopicTier", () => {
  it("distinguishes clearing a row from mapping it to standard", () => {
    const mapping: TierMapping = { "#flashcards/lang": "core" };
    const subtopic = "#flashcards/lang/certexam";

    const pinned = withTopicTier(mapping, subtopic, "standard");
    const cleared = withTopicTier(pinned, subtopic, null);

    // Pinned, the subtopic escapes its parent's core; cleared, it inherits again.
    expect(rowFor(subtopic, pinned)?.effective).toBe("standard");
    expect(rowFor(subtopic, cleared)?.effective).toBe("core");
  });
});

describe("distinctTopicTags", () => {
  it("lists a tag once however many notes carry it", () => {
    const notes = [
      { topicTags: ["#flashcards/git", "#flashcards/shell"] },
      { topicTags: ["#flashcards/git"] },
    ];

    expect(distinctTopicTags(notes)).toEqual(["#flashcards/git", "#flashcards/shell"]);
  });
});
