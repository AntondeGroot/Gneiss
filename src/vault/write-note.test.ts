import { describe, expect, it } from "vitest";

import { editedNote } from "./write-note.js";
import { withReviewState } from "./write-review.js";

/** A note written on Windows, as it sits on disk. */
const CRLF_NOTE = [
  "What does grep do? :: search text for a pattern",
  "",
  "#flashcards/shell",
  "",
].join("\r\n");

describe("editedNote", () => {
  it("writes nothing when the transform handed the note straight back", () => {
    const note = "What does grep do? :: search text for a pattern\n\n#flashcards/shell\n";

    const edited = editedNote(note, (md) =>
      withReviewState(md, "A question this note no longer carries", 0, {
        due: "2026-09-01",
        interval: 3,
        ease: 2.5,
      }),
    );

    // Not a contrived transform: refusing an unknown front is what `withReviewState`
    // is documented to do, and a grade re-applied after a vault read often lands on
    // a note already holding it. Writing those touches the file's timestamp with
    // nothing to show for it, which can only ever manufacture a conflict.
    expect(edited).toBeNull();
  });

  it("changes the one line a grade touches, not every line of a CRLF note", () => {
    const edited = editedNote(CRLF_NOTE, (md) =>
      withReviewState(md, "What does grep do?", 0, { due: "2026-09-01", interval: 3, ease: 2.5 }),
    );

    // The transforms work in `\n` and normalise the whole file on the way in, so
    // without putting the endings back a single grade rewrites every line — which
    // to whatever is syncing the folder is the note being replaced, not edited.
    expect(edited).toBe(
      [
        "What does grep do? :: search text for a pattern",
        "<!--SR:!2026-09-01,3,250-->",
        "",
        "#flashcards/shell",
        "",
      ].join("\r\n"),
    );
  });
});
