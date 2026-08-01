import { describe, expect, it } from "vitest";

import { formatReviewComment, parseReviewStates } from "./review-state.js";

describe("parseReviewStates", () => {
  it("reads due, interval, and ease, scaling the integer-percent ease to a factor", () => {
    const answer = `Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->`;

    expect(parseReviewStates(answer)).toEqual([{ due: "2026-08-21", interval: 3, ease: 2.5 }]);
  });
});

describe("formatReviewComment", () => {
  it("writes back the exact bytes it parsed, so an untouched card is never rewritten", () => {
    const comment = "<!--SR:!2026-08-21,3,250-->";

    expect(formatReviewComment(parseReviewStates(comment))).toBe(comment);
  });

  it("reads every entry of a multi-card comment and writes them back in order", () => {
    const comment = "<!--SR:!2026-08-21,3,250!2026-09-02,12,270-->";

    const states = parseReviewStates(comment);

    expect(states).toEqual([
      { due: "2026-08-21", interval: 3, ease: 2.5 },
      { due: "2026-09-02", interval: 12, ease: 2.7 },
    ]);
    expect(formatReviewComment(states)).toBe(comment);
  });
});
