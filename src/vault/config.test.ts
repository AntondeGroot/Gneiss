import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, formatConfig, parseConfig } from "./config.js";
import type { GneissConfig } from "./config.js";

describe("config round trip", () => {
  it("survives being written and read back without losing a setting", () => {
    const config: GneissConfig = {
      spread: 0.65,
      newPerDay: 12,
      reviewsPerDay: 25,
      streak: 4,
      lastReviewedOn: "2026-08-01",
      reminderOn: true,
      reminderAt: "07:15",
      tiers: { "#flashcards/git": "core", "#flashcards/lang/certexam": "optional" },
      cram: { active: true, scope: "#flashcards/lang/certexam", examDate: "2026-09-01" },
    };

    expect(parseConfig(formatConfig(config))).toEqual(config);
  });
});

describe("parseConfig", () => {
  it("reads settings a user typed by hand", () => {
    const written = `---
spread: 0.5
newPerDay: 8
tiers:
  "#flashcards/git": core
  "#flashcards/tools": standard
cram:
  active: true
  scope: "#flashcards/lang"
  examDate: 2026-12-01
---

# Gneiss

Notes below the frontmatter are ignored.
`;

    expect(parseConfig(written)).toEqual({
      spread: 0.5,
      newPerDay: 8,
      reviewsPerDay: 30,
      streak: 0,
      lastReviewedOn: "",
      reminderOn: false,
      reminderAt: "08:30",
      tiers: { "#flashcards/git": "core", "#flashcards/tools": "standard" },
      cram: { active: true, scope: "#flashcards/lang", examDate: "2026-12-01" },
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

  it("treats a cram missing its scope or date as no cram at all", () => {
    const halfWritten = `---
cram:
  active: true
---
`;

    // A cram with no scope would otherwise clamp against an undefined date.
    expect(parseConfig(halfWritten).cram).toBeNull();
  });
});
