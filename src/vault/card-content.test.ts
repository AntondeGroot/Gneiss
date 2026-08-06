import { describe, expect, it } from "vitest";

import { splitCard, splitInline } from "./card-content.js";

/** The parts worth asserting; `raw` is checked only where it carries meaning. */
function shape(text: string) {
  return splitCard(text).map((segment) => {
    if (segment.kind === "text") return { kind: segment.kind, text: segment.text };
    if (segment.kind === "code") {
      return { kind: segment.kind, code: segment.code, language: segment.language };
    }
    if (segment.kind === "tasks") {
      return { kind: segment.kind, items: segment.items.map((item) => plain(item.parts)) };
    }
    return { kind: segment.kind, target: segment.target, embedded: segment.embedded };
  });
}

/** A card's text with its marks stripped, for asserting what a line says. */
function plain(parts: readonly { kind: string; text: string }[]): string {
  return parts.map((part) => part.text).join("");
}

describe("splitCard", () => {
  it("turns a checklist into a list, keeping the sentence above it", () => {
    const back =
      "Revert kun je op 2 manieren doen\n- [ ] een merge reverten\n- [x] een commit reverten";

    expect(shape(back)).toEqual([
      { kind: "text", text: "Revert kun je op 2 manieren doen" },
      { kind: "tasks", items: ["een merge reverten", "een commit reverten"] },
    ]);
  });

  it("pulls out a pasted image, keeping the prose either side", () => {
    const back = "The stages run left to right.\n![[Pasted image 20260104.png]]\nThat is all.";

    expect(shape(back)).toEqual([
      { kind: "text", text: "The stages run left to right." },
      { kind: "embed", target: "Pasted image 20260104.png", embedded: true },
      { kind: "text", text: "That is all." },
    ]);
  });

  it("reads the markdown form, and undoes the escaping in its path", () => {
    expect(shape("![flow](assets/my%20diagram.png)")).toEqual([
      { kind: "embed", target: "assets/my diagram.png", embedded: true },
    ]);
  });

  it("drops the display width from a sized embed, keeping the file name", () => {
    // `|300` is how Obsidian sets a width. The file is what has to be found.
    expect(shape("![[diagram.png|300]]")).toEqual([
      { kind: "embed", target: "diagram.png", embedded: true },
    ]);
  });

  it("leaves an external image address exactly as written", () => {
    // Decoding a URL would change what it points at.
    expect(shape("![remote](https://example.com/a%20b.png)")).toEqual([
      { kind: "embed", target: "https://example.com/a%20b.png", embedded: true },
    ]);
  });

  it("gives a fenced block back as code, with its language and without the fences", () => {
    const back = "```sh\ngrep -r 'x' .\n```";

    expect(shape(back)).toEqual([{ kind: "code", code: "grep -r 'x' .", language: "sh" }]);
  });

  it("handles several images in one answer", () => {
    expect(shape("![[one.png]]\n![[two.png]]").filter((s) => s.kind === "embed")).toHaveLength(2);
  });
});

describe("wikilinks without the embed marker", () => {
  it("offers a bare link as a candidate, marked as not demanded by the note", () => {
    // Whether this is a picture is the vault's to answer — guessing from the
    // extension was wrong, since a file pasted as `.pgn` is still an image.
    expect(shape("[[Pasted image 20260104.png]]")).toEqual([
      { kind: "embed", target: "Pasted image 20260104.png", embedded: false },
    ]);
  });

  it("offers a note link the same way, for the vault to turn down", () => {
    // Nothing in the vault answers to `MVC`, so the screen puts the text back.
    // The other half of that is covered in card-body.spec.
    expect(shape("[[MVC]]")).toEqual([{ kind: "embed", target: "MVC", embedded: false }]);
  });

  it("keeps the original text, so a link that is not a file can be shown again", () => {
    const [segment] = splitCard("[[MVC]]");

    expect(segment?.kind === "embed" && segment.raw).toBe("[[MVC]]");
  });

  it("keeps surrounding prose when a bare link sits in the middle", () => {
    expect(shape("Before\n[[shot.png]]\nAfter").map((s) => s.kind)).toEqual([
      "text",
      "embed",
      "text",
    ]);
  });

  it("marks an embed as demanded even with no extension at all", () => {
    // With the `!` the note said "embed this", so a miss is worth reporting.
    expect(shape("![[diagram]]")).toEqual([{ kind: "embed", target: "diagram", embedded: true }]);
  });
});

describe("fenced code", () => {
  it("keeps prose either side of a block", () => {
    const back = "Run this:\n```sh\ngrep -r 'x' .\n```\nThen check the output.";

    expect(shape(back)).toEqual([
      { kind: "text", text: "Run this:" },
      { kind: "code", code: "grep -r 'x' .", language: "sh" },
      { kind: "text", text: "Then check the output." },
    ]);
  });

  it("keeps the indentation inside a block, because it is the content", () => {
    const back = "```java\nclass A {\n    void go() {}\n}\n```";

    expect(shape(back)[0]).toEqual({
      kind: "code",
      code: "class A {\n    void go() {}\n}",
      language: "java",
    });
  });

  it("leaves the language empty when the fence has none", () => {
    expect(shape("```\nplain\n```")[0]).toEqual({ kind: "code", code: "plain", language: "" });
  });

  it("does not treat an embed inside code as a picture", () => {
    // A snippet showing the syntax is a line of code, not a diagram to load.
    const back = "```md\n![[diagram.png]]\n```";

    expect(shape(back)).toEqual([{ kind: "code", code: "![[diagram.png]]", language: "md" }]);
  });

  it("still shows an unclosed block as code", () => {
    // The note meant it as code; a stray ``` in the prose helps nobody.
    expect(shape("```sh\nhalf a block")[0]).toEqual({
      kind: "code",
      code: "half a block",
      language: "sh",
    });
  });

  it("handles two blocks in one answer", () => {
    const back = "```sh\na\n```\nbetween\n```sh\nb\n```";

    expect(shape(back).map((s) => s.kind)).toEqual(["code", "text", "code"]);
  });
});

describe("fences that are not on their own line", () => {
  it("opens a block where the fence is glued to the end of a sentence", () => {
    // Strict markdown wants the fence on its own line. Notes are written
    // quickly, and this is plainly meant as code.
    expect(shape("Run this:```sh\ngrep -r 'x' .\n```")).toEqual([
      { kind: "text", text: "Run this:" },
      { kind: "code", code: "grep -r 'x' .", language: "sh" },
    ]);
  });

  it("keeps the text that follows a closing fence on the same line", () => {
    expect(shape("```sh\nls\n```then check").map((s) => s.kind)).toEqual(["code", "text"]);
  });

  it("treats a fence written entirely inline as code with no language", () => {
    // Nothing after the marker is a line of its own, so nothing named a language.
    expect(shape("use ```grep``` to search")).toEqual([
      { kind: "text", text: "use " },
      { kind: "code", code: "grep", language: "" },
      { kind: "text", text: " to search" },
    ]);
  });
});

describe("splitInline", () => {
  it("separates a backticked span from the words around it", () => {
    expect(splitInline("The `--staged` flag unstages a file.")).toEqual([
      { kind: "words", text: "The " },
      { kind: "code", text: "--staged" },
      { kind: "words", text: " flag unstages a file." },
    ]);
  });

  it("separates a bold span the same way", () => {
    expect(splitInline("Use **git switch** now.")).toEqual([
      { kind: "words", text: "Use " },
      { kind: "bold", text: "git switch" },
      { kind: "words", text: " now." },
    ]);
  });

  it("leaves asterisks that never close as written", () => {
    // Emphasis someone started and abandoned is still just a sentence.
    expect(splitInline("2 ** 8 is 256")).toEqual([{ kind: "words", text: "2 ** 8 is 256" }]);
  });

  it("keeps asterisks inside a backticked span literal", () => {
    // The backtick opens first, so the code span swallows them — a glob is not
    // an unclosed bold.
    expect(splitInline("Run `ls **/*.ts` here")).toEqual([
      { kind: "words", text: "Run " },
      { kind: "code", text: "ls **/*.ts" },
      { kind: "words", text: " here" },
    ]);
  });

  it("leaves a lone backtick as written", () => {
    // Punctuation in a sentence, not the start of something.
    const text = "A ` on its own is not code.";

    expect(splitInline(text)).toEqual([{ kind: "words", text }]);
  });

  it("reaches spans at either end", () => {
    expect(splitInline("`git` then `grep`")).toEqual([
      { kind: "code", text: "git" },
      { kind: "words", text: " then " },
      { kind: "code", text: "grep" },
    ]);
  });

  it("gives prose segments their parts already split", () => {
    const [segment] = splitCard("Use `grep` here.");

    expect(segment?.kind === "text" && segment.parts).toEqual([
      { kind: "words", text: "Use " },
      { kind: "code", text: "grep" },
      { kind: "words", text: " here." },
    ]);
  });
});

describe("a question that holds a code block", () => {
  it("shows it as a block, not as an inline span", () => {
    // The real shape that broke: the fenced block is in the *question*. Joined
    // with spaces it arrived as one line, and code with no line breaks reads as
    // something written inline.
    const front = [
      "what does the following do?",
      "```java",
      "interface Flyable {",
      "    public default void fly() {",
      '        System.out.print("Default fly");',
      "    };",
      "}",
      "```",
    ].join("\n");

    expect(shape(front)).toEqual([
      { kind: "text", text: "what does the following do?" },
      {
        kind: "code",
        language: "java",
        code: [
          "interface Flyable {",
          "    public default void fly() {",
          '        System.out.print("Default fly");',
          "    };",
          "}",
        ].join("\n"),
      },
    ]);
  });
});
