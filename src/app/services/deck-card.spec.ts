import { deckNotes } from "./deck-card";
import type { ParsedNote } from "../../vault";

function note(path: string, tags: string[] = ["#flashcards/lang"]): ParsedNote {
  return {
    note: path,
    topicTags: tags,
    cards: [{ front: "el paraguas", back: "the umbrella", occurrence: 0 }],
  };
}

describe("deckNotes", () => {
  /**
   * A conflicted copy holds the same cards as the note beside it, so left in the
   * deck every one of them is asked twice — and since a card's identity includes
   * its note's path, nothing downstream can tell the two apart to drop one.
   *
   * It is dropped here rather than merged here, and that ordering is the point:
   * the duplicates stop the moment the vault is read, without waiting for anyone
   * to sit down and resolve anything. Merging is a separate, unhurried job.
   *
   * The copy is tagged and full of cards, because that is what makes it dangerous
   * — every other reason a note is skipped would happily let this one through.
   */
  it("drops a conflicted copy even though it is tagged and holds cards", () => {
    const notes = [
      note("Norwegian.md"),
      note("Norwegian (Conflicted copy host-abc 202608060948).md"),
      note("Norwegian.sync-conflict-20260806-094800-ABCDEFG.md"),
      note("Untagged.md", []),
    ];

    expect(deckNotes(notes).map((kept) => kept.note)).toEqual(["Norwegian.md"]);
  });

  /**
   * The other half of the rule, and the reason it is a rule about *pairs*.
   *
   * A copy is skipped because the note beside it says the same thing. With no
   * such note — the original renamed or deleted while the copy stayed behind —
   * skipping it is not de-duplicating, it is throwing away the only surviving
   * copy of that material, silently and with nothing on screen to say so.
   *
   * So the check is for a duplicate, not for a filename.
   */
  it("keeps a conflicted copy whose original is gone", () => {
    const orphan = note("Norwegian (Conflicted copy host-abc 202608060948).md");

    expect(deckNotes([orphan]).map((kept) => kept.note)).toEqual([orphan.note]);
  });
});
