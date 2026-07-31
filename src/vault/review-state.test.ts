import { describe, expect, it } from "vitest";

import { parseReviewStates } from "./review-state.js";

describe("parseReviewStates", () => {
  it("reads due, interval, and ease, scaling the integer-percent ease to a factor", () => {
    const answer = `Redirects stderr into stdout.
<!--SR:!2026-08-21,3,250-->`;

    expect(parseReviewStates(answer)).toEqual([{ due: "2026-08-21", interval: 3, ease: 2.5 }]);
  });
});