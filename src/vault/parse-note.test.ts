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
        back: "Redirects stderr into stdout.",
        review: { due: "2026-08-21", interval: 3, ease: 2.5 },
      },
    ]);
  });
});