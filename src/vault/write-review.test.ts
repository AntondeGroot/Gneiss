import { describe, expect, it } from "vitest";

import { parseNote } from "./parse-note.js";
import type { ReviewState } from "./types.js";
import { withReviewState } from "./write-review.js";

const NOTE = `# grep

Search recursively? :: grep -r "pattern" .

Show line numbers?
?
grep -n "pattern" file
<!--SR:!2026-08-21,3,250-->

#flashcards/shell
`;

const GRADED: ReviewState = { due: "2026-09-15", interval: 12, ease: 2.7 };

describe("withReviewState", () => {
  /**
   * A reversed `??` card is two cards sharing one comment, one entry per
   * direction, in order. Grading either one must rewrite *its* entry and leave
   * the other's byte-for-byte — the two directions are genuinely learned at
   * different rates, which is the whole reason the plugin stores two.
   *
   * Writing a single entry here is what a naive implementation does, and it
   * would silently discard the sibling's history — which in a vault carried over
   * from the plugin is years of it.
   */
  it("keeps the other direction's entry when one direction is graded", () => {
    const reversed = `el rompecabezas
??
the jigsaw puzzle
<!--SR:!2026-03-01,14,290!2026-03-04,16,300-->

#flashcards/lang
`;

    // The reverse direction: its question is the answer above.
    const written = withReviewState(reversed, "the jigsaw puzzle", 0, GRADED);

    // The whole note, not just the comment: this edits mid-note in a file the
    // app cannot restore, so every byte outside the one entry must be shown to
    // survive — the card's text, the blank line and the tag block included.
    expect(written).toBe(`el rompecabezas
??
the jigsaw puzzle
<!--SR:!2026-03-01,14,290!2026-09-15,12,270-->

#flashcards/lang
`);
  });

  /**
   * The SR plugin has a `cardCommentOnSameLine` setting. It is off by default,
   * but a vault written with it on carries an inline card's state at the end of
   * the card's own line rather than below it.
   *
   * Such a comment is replaced where it stands. Writing a fresh one on the line
   * below instead would leave the card holding two schedules — and the plugin,
   * reading the same note, takes the first, so the stale one would win.
   */
  it("replaces a comment written on the card's own line, rather than adding a second", () => {
    const sameLine = `What does grep do? :: search text <!--SR:!2026-09-01,12,250-->

#flashcards/shell
`;

    const written = withReviewState(sameLine, "What does grep do?", 0, GRADED);

    expect(written).toBe(`What does grep do? :: search text <!--SR:!2026-09-15,12,270-->

#flashcards/shell
`);
  });

  /**
   * The safety net under the queue's ordering guarantee.
   *
   * The forward direction is always offered first, so by the time the reverse
   * one is graded its sibling's entry is already there. Should that ever stop
   * holding, the entries are still positional: writing the reverse direction's
   * schedule as the *only* entry would hand it to the forward direction on the
   * next read, and nothing downstream could tell that had happened.
   *
   * Refusing is the answer this module already gives a front it cannot find. It
   * loses a grade, which is bad; a card silently carrying the other direction's
   * schedule is worse, and unlike a lost grade it never announces itself.
   */
  it("refuses to grade the reverse direction while the forward one has no entry", () => {
    const unseen = `el hormiguero
??
the anthill

#flashcards/lang
`;

    expect(withReviewState(unseen, "the anthill", 0, GRADED)).toBe(unseen);
  });

  /**
   * A reversed card's answer is also a question — its other direction's — so it
   * can collide with a one-way card elsewhere in the note that happens to ask
   * the same thing. Two cards, same front, and only `occurrence` separates them.
   *
   * The count has to run over both directions in the order they are emitted, or
   * the reverse direction of the reversed card and the one-way card above it
   * share an identity: a grade meant for one lands on the other, and the card
   * actually answered never records anything.
   */
  it("tells a reverse direction apart from a one-way card asking the same question", () => {
    const collides = `the umbrella
?
you open it in the rain
<!--SR:!2026-05-01,20,250-->

el paraguas
??
the umbrella
<!--SR:!2026-03-01,14,290!2026-03-04,16,300-->

#flashcards/lang
`;

    // Occurrence 1: the reversed card's other direction, not the one-way card.
    const written = withReviewState(collides, "the umbrella", 1, GRADED);

    expect(written).toBe(`the umbrella
?
you open it in the rain
<!--SR:!2026-05-01,20,250-->

el paraguas
??
the umbrella
<!--SR:!2026-03-01,14,290!2026-09-15,12,270-->

#flashcards/lang
`);
  });

  /**
   * The bug this exists for: a note may ask the same question twice — two cards,
   * since the answers differ — and matching on the question alone sent both
   * grades to the first of them. The second could never record one, so it fell
   * due again every day however often it was answered.
   */
  it("keeps a separate schedule for each card asking the same question", () => {
    const twice = `Which comes out?
?
the first

Which comes out?
?
the second

#flashcards/shell
`;

    const written = withReviewState(twice, "Which comes out?", 1, GRADED);

    // The first card is untouched — it has no comment at all, so the grade went
    // to the card it was given and not to the one that merely reads the same.
    expect(parseNote(written, "shell.md").cards).toEqual([
      { front: "Which comes out?", back: "the first", occurrence: 0 },
      { front: "Which comes out?", back: "the second", occurrence: 1, review: GRADED },
    ]);
  });

  it("replaces an existing comment and changes nothing else in the note", () => {
    expect(withReviewState(NOTE, "Show line numbers?", 0, GRADED)).toBe(`# grep

Search recursively? :: grep -r "pattern" .

Show line numbers?
?
grep -n "pattern" file
<!--SR:!2026-09-15,12,270-->

#flashcards/shell
`);
  });

  it("adds the comment on its own line beneath a block answer that had none", () => {
    const unreviewed = `Show line numbers?
?
grep -n "pattern" file

#flashcards/shell
`;

    expect(withReviewState(unreviewed, "Show line numbers?", 0, GRADED)).toBe(`Show line numbers?
?
grep -n "pattern" file
<!--SR:!2026-09-15,12,270-->

#flashcards/shell
`);
  });

  it("puts an inline card's comment on the line below it, where the plugin does", () => {
    expect(withReviewState(NOTE, "Search recursively?", 0, GRADED)).toBe(`# grep

Search recursively? :: grep -r "pattern" .
<!--SR:!2026-09-15,12,270-->

Show line numbers?
?
grep -n "pattern" file
<!--SR:!2026-08-21,3,250-->

#flashcards/shell
`);
  });

  it("leaves the note untouched when no card matches that question", () => {
    // The question was edited or deleted since the card was scheduled. Writing
    // state to a best-guess card would corrupt an unrelated card's history.
    expect(withReviewState(NOTE, "A question that is not in this note", 0, GRADED)).toBe(NOTE);
  });

  it("writes only the named card, leaving its siblings' state alone", () => {
    const written = withReviewState(NOTE, "Search recursively?", 0, GRADED);
    const cards = parseNote(written, "grep.md").cards;

    expect(cards[0]?.review).toEqual(GRADED);
    // The block card below it keeps the state it already had.
    expect(cards[1]?.review).toEqual({ due: "2026-08-21", interval: 3, ease: 2.5 });
  });

  it("round-trips: what is written is what parses back out", () => {
    const written = withReviewState(NOTE, "Show line numbers?", 0, GRADED);

    expect(parseNote(written, "grep.md").cards[1]?.review).toEqual(GRADED);
  });
});
