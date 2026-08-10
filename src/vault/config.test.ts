import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, formatConfig, parseConfig } from "./config.js";
import type { GneissConfig } from "./config.js";

describe("config round trip", () => {
  it("survives being written and read back without losing a setting", () => {
    const config: GneissConfig = {
      spread: 0.65,
      newPerSession: 12,
      reviewsPerSession: 25,
      streak: 4,
      lastReviewedOn: "2026-08-01",
      lastSessionOn: "2026-08-01",
      reminderOn: true,
      reminderAt: "07:15",
      backupReminderOn: true,
      backupReminderAt: "21:30",
      cramMinPasses: 4,
      tiers: { "#flashcards/git": "core", "#flashcards/lang/certexam": "optional" },
      crams: [
        { scope: "#flashcards/lang/certexam", examDate: "2026-09-01", perSession: 12 },
        { scope: "#flashcards/Angular", examDate: "2026-09-03", perSession: 8 },
      ],
    };

    expect(parseConfig(formatConfig(config))).toEqual(config);
  });
});

describe("parseConfig", () => {
  it("reads settings a user typed by hand", () => {
    const written = `---
spread: 0.5
newPerSession: 8
tiers:
  "#flashcards/git": core
  "#flashcards/tools": standard
crams:
  - scope: "#flashcards/lang"
    examDate: 2026-12-01
---

# Gneiss

Notes below the frontmatter are ignored.
`;

    expect(parseConfig(written)).toEqual({
      spread: 0.5,
      newPerSession: 8,
      reviewsPerSession: 10,
      streak: 0,
      lastReviewedOn: "",
      lastSessionOn: "",
      reminderOn: false,
      reminderAt: "08:30",
      backupReminderOn: false,
      backupReminderAt: "20:00",
      // Absent from the file, so the default stands — a hand-written config
      // need not list every setting.
      cramMinPasses: 3,
      tiers: { "#flashcards/git": "core", "#flashcards/tools": "standard" },
      crams: [{ scope: "#flashcards/lang", examDate: "2026-12-01", perSession: 10 }],
    });
  });

  it("falls back to defaults when the file is missing or has no frontmatter", () => {
    // First launch reads nothing; a half-synced file can arrive truncated.
    expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("# Gneiss\n\nJust prose.\n")).toEqual(DEFAULT_CONFIG);
  });

  it("drops a tier it does not recognise rather than trusting it", () => {
    const typo = `---
tiers:
  "#flashcards/git": core
  "#flashcards/lang": critical
---
`;

    // "critical" is not a tier. Accepting it would put a value into the mapping
    // that tierGrowth has no case for, and the note would silently mis-schedule.
    expect(parseConfig(typo).tiers).toEqual({ "#flashcards/git": "core" });
  });

  it("drops an exam missing its scope or date, keeping the ones beside it", () => {
    const halfWritten = `---
crams:
  - scope: "#flashcards/lang"
  - scope: "#flashcards/Angular"
    examDate: 2026-09-03
---
`;

    // An exam with no date would otherwise clamp against an undefined deadline.
    expect(parseConfig(halfWritten).crams).toEqual([
      { scope: "#flashcards/Angular", examDate: "2026-09-03", perSession: 10 },
    ]);
  });
});

describe("several exams in the config", () => {
  it("round-trips a week of them, in the order they were written", () => {
    const week = [
      { scope: "#flashcards/lang/certexam", examDate: "2026-09-01", perSession: 12 },
      { scope: "#flashcards/Angular", examDate: "2026-09-03", perSession: 8 },
      { scope: "#flashcards/Java", examDate: "2026-09-03", perSession: 5 },
    ];

    // Two on the same day is ordinary, not a clash — they are different topics.
    expect(parseConfig(formatConfig({ ...DEFAULT_CONFIG, crams: week })).crams).toEqual(week);
  });

  it("writes no exam section at all when there are none", () => {
    // An empty `crams:` heading would read as a setting that had been cleared.
    expect(formatConfig({ ...DEFAULT_CONFIG, crams: [] })).not.toContain("crams:");
  });

  it("keeps the tier map readable beside the list", () => {
    const written = formatConfig({
      ...DEFAULT_CONFIG,
      tiers: { "#flashcards/git": "core" },
      crams: [{ scope: "#flashcards/Java", examDate: "2026-09-03", perSession: 5 }],
    });

    // The two nested shapes sit next to each other; parsing must not run one
    // into the other.
    const back = parseConfig(written);
    expect(back.tiers).toEqual({ "#flashcards/git": "core" });
    expect(back.crams).toHaveLength(1);
  });
});
