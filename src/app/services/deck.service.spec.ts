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
