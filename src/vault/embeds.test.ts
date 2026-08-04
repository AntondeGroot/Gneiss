import { describe, expect, it } from "vitest";

import { splitEmbeds } from "./embeds.js";

/** The parts worth asserting; `raw` is checked only where it carries meaning. */
function shape(text: string) {
  return splitEmbeds(text).map((segment) =>
    segment.kind === "text"
      ? { kind: segment.kind, text: segment.text }
      : { kind: segment.kind, target: segment.target, embedded: segment.embedded },
  );
}

describe("splitEmbeds", () => {
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

  it("keeps a code block intact rather than reflowing it", () => {
    const back = "```sh\ngrep -r 'x' .\n```";

    expect(shape(back)).toEqual([{ kind: "text", text: back }]);
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
    const [segment] = splitEmbeds("[[MVC]]");

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
