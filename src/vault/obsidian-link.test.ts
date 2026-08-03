import { describe, expect, it } from "vitest";

import { folderOf, obsidianNoteUri } from "./obsidian-link.js";

describe("obsidianNoteUri", () => {
  it("encodes the separators in a nested path, not just the spaces", () => {
    const uri = obsidianNoteUri("My Vault", "Programming/Old Job/legacy tooling.md");

    // Obsidian's docs are explicit that `/` must arrive as %2F — left raw, the
    // reserved character breaks how the URI is read.
    expect(uri).toBe(
      "obsidian://open?vault=My%20Vault&file=Programming%2FOld%20Job%2Flegacy%20tooling",
    );
  });

  it("drops the .md extension, which Obsidian treats as optional", () => {
    expect(obsidianNoteUri("Vault", "grep.md")).toContain("file=grep");
  });

  it("offers no link at all when the vault cannot be named", () => {
    // Better than a link that opens the wrong vault, or nothing at all.
    expect(obsidianNoteUri("", "grep.md")).toBe("");
    expect(obsidianNoteUri("Vault", "")).toBe("");
  });
});

describe("folderOf", () => {
  it("names the folder a note sits in, which is the branch worth pruning", () => {
    expect(folderOf("Programming/Old Job/legacy.md")).toBe("Programming/Old Job");
  });

  it("is empty for a note at the vault root", () => {
    expect(folderOf("grep.md")).toBe("");
  });
});
