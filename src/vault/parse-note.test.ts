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
});