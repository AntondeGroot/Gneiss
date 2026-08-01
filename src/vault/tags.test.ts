import { describe, expect, it } from "vitest";

import { withTier } from "./tags.js";

/**
 * A note shaped like one from a real SR-plugin vault: a bottom tag block, a block
 * card carrying review state, and an inline card. The content is invented — no
 * real vault data lives in this repo.
 *
 * `#someHashtag` stands in for whatever unrelated tags a note already carries. It
 * earns its place: it proves `withTier` appends after existing tags without
 * reordering, absorbing, or dropping them.
 */
const NOTE = `# Shell redirection

What does \`2>&1\` do?
?
Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->

Redirect stdout to a file :: \`cmd > out.txt\`

#someHashtag
#flashcards/shell
`;

describe("withTier", () => {
  it("appends the tier tag to the existing bottom tag block, leaving the body untouched", () => {
    expect(withTier(NOTE, "core")).toBe(`# Shell redirection

What does \`2>&1\` do?
?
Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->

Redirect stdout to a file :: \`cmd > out.txt\`

#someHashtag
#flashcards/shell
#core
`);
  });

  it("round-trips to the original bytes when the tier returns to standard", () => {
    const promoted = withTier(NOTE, "core");

    expect(withTier(promoted, "standard")).toBe(NOTE);
  });

  it("leaves a note untouched when the user has not tagged it as flashcards", () => {
    const notInTheDeck = `# Shell redirection

What does \`2>&1\` do?
?
Redirects stderr into stdout.
`;

    expect(withTier(notInTheDeck, "core")).toBe(notInTheDeck);
  });

  it("replaces an existing tier tag rather than leaving two in the note", () => {
    const core = withTier(NOTE, "core");

    expect(withTier(core, "optional")).toBe(`# Shell redirection

What does \`2>&1\` do?
?
Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->

Redirect stdout to a file :: \`cmd > out.txt\`

#someHashtag
#flashcards/shell
#optional
`);
  });
});
