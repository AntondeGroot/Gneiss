import { describe, expect, it } from "vitest";

import { withEditedCard, withoutCard } from "./edit-card.js";
import { parseNote } from "./parse-note.js";

const NOTE = `# Shell

Some prose that must survive untouched.

What does grep do? :: search text for a pattern <!--SR:!2026-09-01,12,250-->

How do you stage a hunk?
?
Use \`git add -p\` and answer \`y\`.
<!--SR:!2026-10-01,30,270-->

#flashcards/shell
`;

describe("withEditedCard", () => {
  it("keeps an inline card's review state when its question is corrected", () => {
    const edited = withEditedCard(NOTE, "What does grep do?", {
      front: "What does grep do, exactly?",
      back: "search text for a pattern",
    });

    // The comment sits on the card's own line, so a naive span replacement would
    // drop it — and correcting a typo would silently reset the card's schedule.
    expect(edited).toContain(
      "What does grep do, exactly? :: search text for a pattern <!--SR:!2026-09-01,12,250-->",
    );
    expect(parseNote(edited, "shell.md").cards[0]?.review?.interval).toBe(12);
  });

  it("keeps a block card's review state, which sits on its own line", () => {
    const edited = withEditedCard(NOTE, "How do you stage a hunk?", {
      front: "How do you stage a single hunk?",
      back: "Use `git add -p` and answer `y`.",
    });

    const card = parseNote(edited, "shell.md").cards[1];
    expect(card?.front).toBe("How do you stage a single hunk?");
    expect(card?.review?.interval).toBe(30);
  });

  it("leaves every other byte of the note alone", () => {
    const edited = withEditedCard(NOTE, "What does grep do?", {
      front: "What does grep do?",
      back: "search text for a pattern",
    });

    expect(edited).toContain("Some prose that must survive untouched.");
    expect(edited).toContain("#flashcards/shell");
    expect(parseNote(edited, "shell.md").cards).toHaveLength(2);
  });

  it("refuses to touch the note when no card has that question", () => {
    expect(withEditedCard(NOTE, "Never asked", { front: "x", back: "y" })).toBe(NOTE);
  });
});

describe("withoutCard", () => {
  it("removes just the card, leaving its neighbours intact", () => {
    const trimmed = withoutCard(NOTE, "What does grep do?");

    const remaining = parseNote(trimmed, "shell.md");
    expect(remaining.cards.map((card) => card.front)).toEqual(["How do you stage a hunk?"]);
    expect(trimmed).toContain("Some prose that must survive untouched.");
    expect(trimmed).toContain("#flashcards/shell");
  });

  it("takes the block card's review comment with it, leaving no orphan", () => {
    const trimmed = withoutCard(NOTE, "How do you stage a hunk?");

    // An SR comment left behind would attach itself to whatever card came next.
    expect(trimmed).not.toContain("2026-10-01");
    expect(parseNote(trimmed, "shell.md").cards[0]?.review?.interval).toBe(12);
  });

  it("does not leave a growing gap where the card was", () => {
    const trimmed = withoutCard(NOTE, "What does grep do?");

    expect(trimmed).not.toContain("\n\n\n");
  });
});
