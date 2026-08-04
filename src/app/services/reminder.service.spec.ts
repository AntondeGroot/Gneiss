import { nextBackup } from "./reminder.service";

// Only the scheduling rule is under test; the plugin is stubbed so importing the
// service does not reach for a native bridge that is not there.
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { cancel: vi.fn(), schedule: vi.fn(), checkPermissions: vi.fn() },
}));

/** A fixed afternoon, so "has tonight passed?" is a decision and not the clock's. */
const AFTERNOON = new Date("2026-08-04T14:00:00");
const LATE_EVENING = new Date("2026-08-04T22:30:00");

describe("nextBackup", () => {
  it("nudges tonight when no session has been finished yet", () => {
    const when = nextBackup("20:00", false, AFTERNOON);

    expect(when.getDate()).toBe(4);
    expect(when.getHours()).toBe(20);
    expect(when.getMinutes()).toBe(0);
  });

  it("moves to tomorrow once a session has been finished", () => {
    const when = nextBackup("20:00", true, AFTERNOON);

    // The whole point: a day that went well stays quiet.
    expect(when.getDate()).toBe(5);
    expect(when.getHours()).toBe(20);
  });

  it("moves to tomorrow when tonight's time has already gone", () => {
    const when = nextBackup("20:00", false, LATE_EVENING);

    // Arriving at 22:30 to say the evening was missed helps nobody.
    expect(when.getDate()).toBe(5);
  });

  it("reads the time it was given rather than assuming eight", () => {
    const when = nextBackup("21:45", false, AFTERNOON);

    expect(when.getHours()).toBe(21);
    expect(when.getMinutes()).toBe(45);
  });

  it("rolls into the next month rather than landing on the 32nd", () => {
    const monthEnd = new Date("2026-08-31T22:00:00");

    const when = nextBackup("20:00", false, monthEnd);

    expect(when.getMonth()).toBe(8);
    expect(when.getDate()).toBe(1);
  });
});
