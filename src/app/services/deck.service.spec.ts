import { DEFAULT_CONFIG } from "../../vault";
import type { ParsedNote, Tier } from "../../vault";

import { DeckService } from "./deck.service";

function note(name: string, topicTags: string[], tierOverride?: Tier): ParsedNote {
  return {
    note: name,
    cards: [{ front: "Question?", back: "Answer" }],
    topicTags,
    ...(tierOverride ? { tierOverride } : {}),
  };
}

describe("DeckService", () => {
  it("re-tiers the loaded deck when the tag mapping is saved", async () => {
    const deck = new DeckService();
    deck.setNotes([note("git.md", ["#flashcards/git"])]);
    expect(deck.all()[0]?.tier).toBe("standard");

    await deck.saveConfig({ ...DEFAULT_CONFIG, tiers: { "#flashcards/git": "core" } });

    // Editing the mapping has to bite on this session's cards. Waiting for the
    // next load would make the table look like it worked while nothing changed.
    expect(deck.all()[0]?.tier).toBe("core");
  });

  it("keeps a per-note tier tag outranking the mapping across a re-tier", async () => {
    const deck = new DeckService();
    deck.setNotes([note("git.md", ["#flashcards/git"], "optional")]);

    await deck.saveConfig({ ...DEFAULT_CONFIG, tiers: { "#flashcards/git": "core" } });

    expect(deck.all()[0]?.tier).toBe("optional");
  });

  it("offers a topic row for a tagged note that holds no cards yet", () => {
    const deck = new DeckService();

    deck.setNotes([{ note: "empty.md", cards: [], topicTags: ["#flashcards/git"] }]);

    // Tagged but unfilled is a topic the user means to tier, so it needs a row
    // even though it contributes nothing to the deck.
    expect(deck.topicTags()).toEqual(["#flashcards/git"]);
  });
});

/** A note whose cards are all overdue, so the whole set counts as backlog. */
function backlog(name: string, cards: number): ParsedNote {
  return {
    note: name,
    cards: Array.from({ length: cards }, (_, i) => ({
      front: `Q${i}`,
      back: "A",
      review: { due: "2024-01-01", interval: 5, ease: 2.5 },
    })),
    topicTags: ["#flashcards/git"],
  };
}

describe("DeckService sessions", () => {
  it("offers the next portion once the current one has been graded", async () => {
    const deck = new DeckService();
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2 });
    deck.setNotes([backlog("git.md", 5)]);

    const first = [...deck.due()];
    expect(first).toHaveLength(2);

    for (const card of first) await deck.grade(card, "medium");

    // Graded cards are scheduled forward, so they leave the due set and the next
    // two take their place. This is what makes "another session" work at all —
    // the daily figure caps the queue in view, it does not lock out the day.
    expect(deck.due()).toHaveLength(2);
    expect(deck.due().map((c) => c.id)).not.toEqual(first.map((c) => c.id));
  });

  it("runs out only when nothing is left to review", async () => {
    const deck = new DeckService();
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2 });
    deck.setNotes([backlog("git.md", 5)]);

    // Session after session, the backlog drains rather than being rationed.
    for (let session = 0; session < 5; session++) {
      for (const card of [...deck.due()]) await deck.grade(card, "medium");
    }

    expect(deck.due()).toHaveLength(0);
  });
});
