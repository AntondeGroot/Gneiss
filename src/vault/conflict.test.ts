import { describe, expect, it } from "vitest";

import { conflictHunks, conflictedCopyOf, mergeNotes } from "./conflict.js";

describe("conflictedCopyOf", () => {
  /**
   * Which files are a sync tool's leftovers, and which are notes someone wrote.
   *
   * This decides whether a file's cards reach the deck at all, so the cost of the
   * two mistakes is lopsided: missing a conflicted copy serves its cards twice,
   * which is visible and annoying, while claiming an ordinary note silently
   * empties it — no error, just material that stops coming up. The patterns are
   * therefore anchored to what tools actually write, and iCloud's `Note 2.md` is
   * deliberately *not* among them: it cannot be told apart from `Chapter 2.md`.
   */
  it("recognises what sync tools name a conflicted copy, and nothing else", () => {
    const cases: [string, string | null][] = [
      // Open-Xchange / ownCloud, which is what the survey vault carried.
      ["Norwegian (Conflicted copy host-abc 202608060948).md", "Norwegian.md"],
      // Dropbox names the device in the possessive.
      ["Norwegian (Anton's conflicted copy 2026-08-06).md", "Norwegian.md"],
      // Nextcloud, lower case and no device.
      ["Norwegian (conflicted copy 2026-08-06 094800).md", "Norwegian.md"],
      // Syncthing puts it in the stem rather than in brackets.
      ["Norwegian.sync-conflict-20260806-094800-ABCDEFG.md", "Norwegian.md"],
      // The path is kept, since the copy sits beside the note it came from.
      ["lang/no/Norwegian (conflicted copy 2026-08-06 094800).md", "lang/no/Norwegian.md"],

      ["Norwegian.md", null],
      ["Chapter 2.md", null],
      // Prose that merely mentions the words is not a filename pattern.
      ["Resolving a conflicted copy.md", null],
      ["Norwegian (draft).md", null],
    ];

    expect(cases.map(([path]) => [path, conflictedCopyOf(path)])).toEqual(cases);
  });
});

describe("conflictHunks", () => {
  /**
   * The division the whole feature rests on: a schedule is never a question for
   * the user, and a difference in what a card *says* always is.
   *
   * Review state settles itself because there is a right answer — the newer
   * review — and asking would be asking someone to compare two dates they have
   * no memory of. Card text has no right answer that can be worked out from the
   * files: a card on one side and not the other was either deleted on purpose or
   * never arrived, and only the person who did it knows which.
   *
   * The reversed card here differs *only* in the second entry of its comment,
   * which is the case that must not surface: it is one card's two directions,
   * and it looks like a text difference to anything that reads the comment as
   * part of the card.
   */
  it("asks about text differences and settles review state silently", () => {
    const mine = `el paraguas
??
the umbrella
<!--SR:!2026-03-01,14,290!2026-03-04,16,300-->

la bombilla :: the light bulb

#flashcards/lang
`;
    const theirs = `el paraguas
??
the umbrella
<!--SR:!2026-03-01,14,290!2026-09-02,8,255-->

la bombilla :: the lightbulb

#flashcards/lang
`;

    expect(conflictHunks(mine, theirs)).toEqual([
      { mine: "la bombilla :: the light bulb\n", theirs: "la bombilla :: the lightbulb\n" },
    ]);
  });
});

describe("mergeNotes", () => {
  /**
   * The rule the app applies so nobody has to: each direction of each card keeps
   * whichever side reviewed it most recently — `due - interval` is the day the
   * review happened, and the longer interval breaks a tie.
   *
   * Entry by entry, not comment by comment, and that is the whole point. The
   * card below was reviewed forwards on one device and backwards on the other,
   * so *neither* comment is right as a whole: taking either one wholesale throws
   * away a real review. Only merging the slots keeps both.
   */
  it("keeps the newest review of each direction, taking neither comment whole", () => {
    // Forward reviewed later here; reverse reviewed later in the copy.
    const mine = `el paraguas
??
the umbrella
<!--SR:!2026-09-20,30,290!2026-03-04,16,300-->

#flashcards/lang
`;
    const theirs = `el paraguas
??
the umbrella
<!--SR:!2026-03-01,14,290!2026-09-02,8,255-->

#flashcards/lang
`;

    expect(mergeNotes(mine, theirs, [])).toBe(`el paraguas
??
the umbrella
<!--SR:!2026-09-20,30,290!2026-09-02,8,255-->

#flashcards/lang
`);
  });
});

describe("mergeNotes resolutions", () => {
  const MINE = `one :: 1

change :: mine

two :: 2

keep :: only in the note

three :: 3
`;
  const THEIRS = `one :: 1

change :: theirs

two :: 2

three :: 3

add :: only in the copy
`;

  /**
   * The three answers, each on the shape it fits: a card that differs, a card
   * only the note has, and a card only the copy has.
   *
   * The unchanged cards between them are load-bearing — they are what keeps the
   * differences apart. With nothing matching, the whole file is one difference
   * and there is nothing to decide separately.
   */
  it("takes theirs, drops ours, and adds a card the copy alone had", () => {
    expect(mergeNotes(MINE, THEIRS, ["theirs", "theirs", "both"])).toBe(`one :: 1

change :: theirs

two :: 2

three :: 3

add :: only in the copy
`);
  });

  /** The mirror: keeping ours everywhere leaves the note exactly as it was. */
  it("leaves the note untouched when every difference is settled our way", () => {
    expect(mergeNotes(MINE, THEIRS, ["mine", "mine", "mine"])).toBe(MINE);
  });
});

describe("mergeNotes tie-breaking", () => {
  /**
   * Two devices graded the same card on the same day, so `due - interval` cannot
   * separate them. The longer interval wins — the same repair rule the app uses
   * on a note that somehow carries two comments, kept the same here so one
   * answer does not depend on which code path reached it.
   */
  it("keeps the longer interval when both sides reviewed on the same day", () => {
    const on = (due: string, interval: number) =>
      `card :: answer\n<!--SR:!${due},${interval},250-->\n`;

    // Both reviewed 2026-08-25: 2026-08-30 - 5 and 2026-09-11 - 17.
    expect(mergeNotes(on("2026-08-30", 5), on("2026-09-11", 17), [])).toBe(on("2026-09-11", 17));
    expect(mergeNotes(on("2026-09-11", 17), on("2026-08-30", 5), [])).toBe(on("2026-09-11", 17));
  });
});

describe("conflictHunks inside a fence", () => {
  /**
   * A blank line inside a fenced block is part of the code, so the card is one
   * card and not two. Getting this wrong would split a snippet down the middle
   * and offer each half as a separate difference to settle.
   */
  it("treats a fenced answer with a blank line in it as one card", () => {
    const withFence = (tail: string) => `How do you sort?
?
\`\`\`java
class Duck {

    int compareTo(Duck other) { return ${tail}; }
}
\`\`\`

#flashcards/lang
`;

    const hunks = conflictHunks(withFence("0"), withFence("1"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.mine).toContain("class Duck {");
    expect(hunks[0]?.mine).toContain("return 0");
  });
});
