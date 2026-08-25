import { describe, expect, it } from "vitest";

import { parseNote } from "./parse-note.js";

describe("parseNote", () => {
  it("keeps a fenced code answer intact, including its blank lines and indentation", () => {
    const md = `How do you sort a custom collection?
?
\`\`\`java
public class Duck implements Comparable<Duck> {

    public int compareTo(Duck other) {
        return name.compareTo(other.name);
    }
}
\`\`\`

#flashcards/lang
`;

    const { cards } = parseNote(md, "sorting.md");

    expect(cards).toEqual([
      {
        front: "How do you sort a custom collection?",
        occurrence: 0,
        back: `\`\`\`java
public class Duck implements Comparable<Duck> {

    public int compareTo(Duck other) {
        return name.compareTo(other.name);
    }
}
\`\`\``,
      },
    ]);
  });

  /**
   * `??` is the SR plugin's reversed card: one written card, two asked of you —
   * term→definition and definition→term — and they are genuinely not learned at
   * the same rate. The plugin stores that as two entries in one comment, in
   * order. The two here are deliberately far apart: fluent one way at `60,310`,
   * and at the ease floor the other way at `1,210`.
   *
   * So the two entries are matched to the two directions **by position**, and
   * reading only the first would hand the reverse direction the forward
   * direction's schedule.
   */
  it("yields both directions of a reversed card, each with its own review state", () => {
    const md = `madrugar
??
to get up early
<!--SR:!2026-04-11,60,310!2026-02-25,1,210-->

#flashcards/lang
`;

    const { cards } = parseNote(md, "vocabulary.md");

    expect(cards).toEqual([
      {
        front: "madrugar",
        back: "to get up early",
        occurrence: 0,
        review: { due: "2026-04-11", interval: 60, ease: 3.1 },
        pair: 0,
      },
      {
        front: "to get up early",
        back: "madrugar",
        occurrence: 0,
        review: { due: "2026-02-25", interval: 1, ease: 2.1 },
        pair: 0,
      },
    ]);
  });

  /**
   * The common case by far: most reversed cards in a vault are still unreviewed,
   * carrying no comment at all. Both directions are then simply unseen, and a
   * card with no state must not be handed an invented one — the
   * queue tells new cards from cards in rotation by the absence of `review`.
   *
   * The question is written with a trailing space, as it is in the note, so the
   * usual trimming is shown to apply to a reversed card's question and to the
   * answer that becomes the other direction's question.
   */
  it("yields two unseen cards for a reversed card carrying no review state", () => {
    const md = `el hormiguero 
??
the anthill

#flashcards/lang
`;

    const { cards } = parseNote(md, "vocabulary.md");

    expect(cards).toEqual([
      // Both directions share `pair`, which is what has a session serve one of them.
      { front: "el hormiguero", back: "the anthill", occurrence: 0, pair: 0 },
      { front: "the anthill", back: "el hormiguero", occurrence: 0, pair: 0 },
    ]);
  });

  /**
   * `?` and `??` differ by a single character, and are told apart by an exact
   * match rather than a prefix. A scanner reaching for `startsWith("?")` would
   * read every one-way card as reversed and quietly double the deck — asking,
   * in one direction, questions the note never posed.
   *
   * The two forms also have to survive each other within one note, which is how
   * they actually appear, so both are here rather than in separate notes.
   */
  it("keeps a one-way card one-way in a note that also holds a reversed one", () => {
    const md = `el paraguas
?
the umbrella

la bombilla
??
the light bulb

#flashcards/lang
`;

    const { cards } = parseNote(md, "vocabulary.md");

    expect(cards).toEqual([
      // The one-way card has no `pair`: it has no sibling to crowd out.
      { front: "el paraguas", back: "the umbrella", occurrence: 0 },
      { front: "la bombilla", back: "the light bulb", occurrence: 0, pair: 4 },
      { front: "the light bulb", back: "la bombilla", occurrence: 0, pair: 4 },
    ]);
  });

  /**
   * Inside a fence every line is content, whatever it looks like — the guarantee
   * a bare `?` already has, now needed by `??` for the same reason: a note about
   * the card format itself holds a worked example of one.
   *
   * This is an ordering constraint on the scanner, not a separate feature. The
   * fence has to be consulted *before* either separator, so a reversed card
   * recognised too eagerly would cut this answer in half and leave the rest of
   * the block loose in the note.
   */
  it("leaves a `??` inside a fenced block as code rather than a card separator", () => {
    const md = `How does a reversed card look in the plugin's own syntax?
?
\`\`\`md
term
??
definition
\`\`\`

#flashcards/lang
`;

    const { cards } = parseNote(md, "vocabulary.md");

    expect(cards).toEqual([
      {
        front: "How does a reversed card look in the plugin's own syntax?",
        occurrence: 0,
        back: `\`\`\`md
term
??
definition
\`\`\``,
      },
    ]);
  });

  it("attaches existing review state to the card and keeps it out of the answer text", () => {
    const md = `What does \`2>&1\` do?
?
Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->

#flashcards/shell
`;

    const { cards } = parseNote(md, "redirection.md");

    expect(cards).toEqual([
      {
        front: "What does `2>&1` do?",
        occurrence: 0,
        back: "Redirects stderr into stdout.",
        review: { due: "2026-08-21", interval: 3, ease: 2.5 },
      },
    ]);
  });

  it("reads a lone dot as a blank line, carrying the answer on past it", () => {
    const md = `What is a merge commit?
?
A commit with two parents.
.
It records that two histories were joined.

#flashcards/git
`;

    const { cards } = parseNote(md, "merge.md");

    // Without the marker the answer ends at the paragraph break, and the second
    // half is left in the note as prose belonging to no card.
    expect(cards).toEqual([
      {
        front: "What is a merge commit?",
        occurrence: 0,
        back: "A commit with two parents.\n\nIt records that two histories were joined.",
      },
    ]);
  });

  it("leaves a lone dot inside a fence as the line of output it is", () => {
    const md = `What does \`ls -a\` show that \`ls\` does not?
?
\`\`\`
.
..
.git
\`\`\`

#flashcards/shell
`;

    const { cards } = parseNote(md, "listing.md");

    // The marker is prose punctuation, and code is not prose: here the dot is the
    // current directory, and swapping it for a blank line would change what the
    // command is shown to print.
    expect(cards[0]?.back).toBe("```\n.\n..\n.git\n```");
  });

  it("reads a dot above the ? as a break in the question", () => {
    const md = `Two branches have been joined into one history.
.
What kind of commit records that?
?
A merge commit.

#flashcards/git
`;

    const { cards } = parseNote(md, "merge.md");

    // A question is often context and then the ask, and the break between them is
    // the reader's pause. Without it the setup would be a card of its own with no
    // answer — dropped — and the question would arrive without what it refers to.
    expect(cards[0]?.front).toBe(
      "Two branches have been joined into one history.\n\nWhat kind of commit records that?",
    );
  });

  it("parses each inline :: line as its own card, trimming around the separator", () => {
    const md = `Redirect stdout to a file :: \`cmd > out.txt\`
Count the lines in a file :: \`wc -l file\`

#flashcards/shell
`;

    const { cards } = parseNote(md, "redirection.md");

    expect(cards).toEqual([
      { front: "Redirect stdout to a file", back: "`cmd > out.txt`", occurrence: 0 },
      { front: "Count the lines in a file", back: "`wc -l file`", occurrence: 0 },
    ]);
  });

  /**
   * Where the SR plugin actually puts it. Reading only the card's own line meant
   * a plugin-written vault imported every inline card as never-seen — months of
   * review discarded, and the card served as new material the next morning.
   */
  it("reads an inline card's review state from the line below, as the plugin writes it", () => {
    const md = `Redirect stdout to a file :: \`cmd > out.txt\`
<!--SR:!2026-08-21,3,250-->

#flashcards/shell
`;

    const { cards } = parseNote(md, "redirection.md");

    expect(cards).toEqual([
      {
        front: "Redirect stdout to a file",
        occurrence: 0,
        back: "`cmd > out.txt`",
        review: { due: "2026-08-21", interval: 3, ease: 2.5 },
      },
    ]);
  });

  it("attaches review state trailing an inline card, keeping it out of the answer", () => {
    const md = `Redirect stdout to a file :: \`cmd > out.txt\` <!--SR:!2026-08-21,3,250-->

#flashcards/shell
`;

    const { cards } = parseNote(md, "redirection.md");

    expect(cards).toEqual([
      {
        front: "Redirect stdout to a file",
        occurrence: 0,
        back: "`cmd > out.txt`",
        review: { due: "2026-08-21", interval: 3, ease: 2.5 },
      },
    ]);
  });

  it("collects only flashcards tags as topics, reading a tier tag as the override", () => {
    const md = `What does \`2>&1\` do?
?
Redirects stderr into stdout.

#someHashtag
#flashcards/shell
#core
`;

    expect(parseNote(md, "redirection.md")).toEqual({
      note: "redirection.md",
      cards: [
        { front: "What does `2>&1` do?", back: "Redirects stderr into stdout.", occurrence: 0 },
      ],
      topicTags: ["#flashcards/shell"],
      tierOverride: "core",
    });
  });

  it("skips YAML frontmatter, parsing only the cards beneath it", () => {
    const md = `---
tier: core
created: 2026-08-01
---

What does \`2>&1\` do?
?
Redirects stderr into stdout.

#flashcards/shell
`;

    // Note there is no tierOverride: a \`tier:\` frontmatter key is not read, since
    // tags are the supported path. Only a #core / #optional tag sets the override.
    expect(parseNote(md, "redirection.md")).toEqual({
      note: "redirection.md",
      cards: [
        { front: "What does `2>&1` do?", back: "Redirects stderr into stdout.", occurrence: 0 },
      ],
      topicTags: ["#flashcards/shell"],
    });
  });
});

describe("fences that are not on their own line", () => {
  it("keeps a whole block whose fence is glued to the sentence before it", () => {
    // A blank line inside the block used to end the card, cutting the answer in
    // half — the fence was not recognised, so the parser was never "inside" it.
    const md = `How do you run it?
?
Run this:\`\`\`sh
set -euo pipefail

grep -r 'x' .
\`\`\`

#flashcards/shell
`;

    const [card] = parseNote(md, "shell.md").cards;

    expect(card?.back).toContain("set -euo pipefail");
    expect(card?.back).toContain("grep -r 'x' .");
  });

  it("stays outside code when a line opens and closes a span", () => {
    const md = `What unstages a file?
?
The \`\`\`--staged\`\`\` flag.

Not part of the answer.

#flashcards/git
`;

    const [card] = parseNote(md, "git.md").cards;

    // Both fences are on one line, so the card ends at the blank line as usual.
    expect(card?.back).toBe("The ```--staged``` flag.");
  });
});

describe("a question spanning several lines", () => {
  it("keeps its line breaks, so a code block in the question stays code", () => {
    const md = `what does the following do?
\`\`\`java
interface Flyable {
    void fly();
}
\`\`\`
?
It declares a functional interface.

#flashcards/lang
`;

    const [card] = parseNote(md, "java.md").cards;

    // Joined with spaces, the block collapsed onto one line and stopped being
    // recognisable as code at all.
    expect(card?.front).toContain("\n```java\n");
    expect(card?.front).toContain("interface Flyable {\n");
  });
});
