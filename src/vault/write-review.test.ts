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
  it("replaces an existing comment and changes nothing else in the note", () => {
    expect(withReviewState(NOTE, "Show line numbers?", GRADED)).toBe(`# grep

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

    expect(withReviewState(unreviewed, "Show line numbers?", GRADED)).toBe(`Show line numbers?
?
grep -n "pattern" file
<!--SR:!2026-09-15,12,270-->

#flashcards/shell
`);
  });

  it("adds the comment to the end of the line for an inline card", () => {
    expect(withReviewState(NOTE, "Search recursively?", GRADED)).toBe(`# grep

Search recursively? :: grep -r "pattern" . <!--SR:!2026-09-15,12,270-->

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
    expect(withReviewState(NOTE, "A question that is not in this note", GRADED)).toBe(NOTE);
  });

  it("writes only the named card, leaving its siblings' state alone", () => {
    const written = withReviewState(NOTE, "Search recursively?", GRADED);
    const cards = parseNote(written, "grep.md").cards;

    expect(cards[0]?.review).toEqual(GRADED);
    // The block card below it keeps the state it already had.
    expect(cards[1]?.review).toEqual({ due: "2026-08-21", interval: 3, ease: 2.5 });
  });

  it("round-trips: what is written is what parses back out", () => {
    const written = withReviewState(NOTE, "Show line numbers?", GRADED);

    expect(parseNote(written, "grep.md").cards[1]?.review).toEqual(GRADED);
  });
});
