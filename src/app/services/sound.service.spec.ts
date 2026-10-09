import { cueFor } from "./sound.service";

describe("cueFor", () => {
  it("plays the goal cue when a session ends, even on a difficult card", () => {
    expect(cueFor("difficult", true)).toBe("goal");
  });
});
