import { describe, expect, it } from "vitest";

import { withTier } from "./tags.js";

/**
 * A note shaped like one from a real SR-plugin vault: a bottom tag block, a block
 * card carrying review state, and an inline card. The content is invented — no
 * real vault data lives in this repo.
 */
const NOTE = `# Shell redirection

What does \`2>&1\` do?
?
Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->

Redirect stdout to a file :: \`cmd > out.txt\`

#done
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

#done
#flashcards/shell
#core
`);
  });

  it("round-trips to the original bytes when the tier returns to standard", () => {
    const promoted = withTier(NOTE, "core");

    expect(withTier(promoted, "standard")).toBe(NOTE);
  });
});