import { localDate, millisUntilNextDay } from "./clock.service";

const HOUR_MS = 60 * 60 * 1000;
/** The grace the tick allows itself so it cannot fire a hair before midnight. */
const SETTLE_MS = 1000;

describe("localDate", () => {
  it("gives the calendar day where the user is, not the one UTC is still having", () => {
    vi.stubEnv("TZ", "Europe/Amsterdam");

    // Half past midnight on the 11th in Amsterdam — and still the 10th in UTC,
    // for another hour and a half. This is the window the day used to roll late
    // in: a review at 00:30 counted towards the day before.
    const justAfterLocalMidnight = new Date("2026-08-10T22:30:00Z");

    expect(localDate(justAfterLocalMidnight)).toBe("2026-08-11");
    // The old implementation, kept here as the thing not to go back to.
    expect(justAfterLocalMidnight.toISOString().slice(0, 10)).toBe("2026-08-10");
  });
});

describe("millisUntilNextDay", () => {
  it("waits for the next local midnight, not for twenty-four hours to pass", () => {
    vi.stubEnv("TZ", "Europe/Amsterdam");

    // Half past midnight on the night the clocks go back: this day is 25 hours
    // long, so counting a fixed 24 would tick an hour early — on a day that has
    // not ended — and then keep drifting.
    const dstNight = new Date(2026, 9, 25, 0, 30);

    expect(millisUntilNextDay(dstNight)).toBe(24.5 * HOUR_MS + SETTLE_MS);
  });

  it("carries into the next month rather than asking for the 32nd", () => {
    const lastNightOfAugust = new Date(2026, 7, 31, 23, 30);

    const tick = new Date(lastNightOfAugust.getTime() + millisUntilNextDay(lastNightOfAugust));

    expect(localDate(tick)).toBe("2026-09-01");
    // Just past the stroke, so the date it reads is unambiguously the new day.
    expect(tick.getHours()).toBe(0);
    expect(tick.getMinutes()).toBe(0);
  });
});
