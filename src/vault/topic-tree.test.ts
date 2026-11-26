import { describe, expect, it } from "vitest";

import { topicRows, weakestTopic } from "./topic-tree.js";
import type { Countable } from "./topic-tree.js";

const TODAY = "2026-08-01";

function card(tag: string, due: string, interval: number, ease = 2.3): Countable {
  return { topicTags: [tag], review: { due, interval, ease } };
}

describe("topicRows", () => {
  /**
   * No note carries `#flashcards/lang` itself, yet it gets a row covering both
   * subtopics — that is how one row stands for a whole subject. The bare
   * `#flashcards` gets none: it would hold the whole deck, which is Today.
   */
  it("gives a parent a row of its own that counts its subtopics, and the root none", () => {
    const cards = [
      card("#flashcards/lang/certexam", TODAY, 3),
      card("#flashcards/lang/certexam", "2026-08-09", 8),
      card("#flashcards/lang/generics", TODAY, 0),
      card("#flashcards", TODAY, 0),
    ];
    const tags = ["#flashcards/lang/certexam", "#flashcards/lang/generics", "#flashcards"];

    const rows = topicRows(cards, tags, TODAY).map(({ tag, depth, due, fresh, ahead, total }) => ({
      tag,
      depth,
      due,
      fresh,
      ahead,
      total,
    }));

    expect(rows).toEqual([
      { tag: "#flashcards/lang", depth: 0, due: 1, fresh: 1, ahead: 1, total: 3 },
      { tag: "#flashcards/lang/certexam", depth: 1, due: 1, fresh: 0, ahead: 1, total: 2 },
      { tag: "#flashcards/lang/generics", depth: 1, due: 0, fresh: 1, ahead: 0, total: 1 },
    ]);
  });
});

describe("weakestTopic", () => {
  /**
   * `shell` has the lowest ease, but four cards met could be a bad week — too
   * few to call it weak. `lang` and `lang/generics` hold the same five cards and
   * tie; the subtopic is the more useful thing to point at.
   */
  it("needs enough cards met to call a topic weak, and prefers the more specific on a tie", () => {
    const generics = Array.from({ length: 5 }, () =>
      card("#flashcards/lang/generics", "2026-08-05", 4, 1.8),
    );
    const shell = Array.from({ length: 4 }, () => card("#flashcards/shell", TODAY, 2, 1.4));
    const tags = ["#flashcards/lang/generics", "#flashcards/shell"];

    const rows = topicRows([...generics, ...shell], tags, TODAY);

    expect(rows.find((row) => row.tag === "#flashcards/shell")?.weak).toBe(false);
    expect(weakestTopic(rows)?.tag).toBe("#flashcards/lang/generics");
  });
});
