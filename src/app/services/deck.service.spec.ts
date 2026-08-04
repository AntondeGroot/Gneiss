import { TestBed } from "@angular/core/testing";

import { DEFAULT_CONFIG, parseNote } from "../../vault";
import type { ParsedNote, Tier } from "../../vault";

import { DeckService } from "./deck.service";

function note(name: string, topicTags: string[], tierOverride?: Tier): ParsedNote {
  return {
    note: name,
    cards: [{ front: "Question?", back: "Answer" }],
    topicTags,
    ...(tierOverride ? { tierOverride } : {}),
  };
}

describe("DeckService", () => {
  it("re-tiers the loaded deck when the tag mapping is saved", async () => {
    const deck = TestBed.inject(DeckService);
    deck.setNotes([note("git.md", ["#flashcards/git"])]);
    expect(deck.all()[0]?.tier).toBe("standard");

    await deck.saveConfig({ ...DEFAULT_CONFIG, tiers: { "#flashcards/git": "core" } });

    // Editing the mapping has to bite on this session's cards. Waiting for the
    // next load would make the table look like it worked while nothing changed.
    expect(deck.all()[0]?.tier).toBe("core");
  });

  it("keeps a per-note tier tag outranking the mapping across a re-tier", async () => {
    const deck = TestBed.inject(DeckService);
    deck.setNotes([note("git.md", ["#flashcards/git"], "optional")]);

    await deck.saveConfig({ ...DEFAULT_CONFIG, tiers: { "#flashcards/git": "core" } });

    expect(deck.all()[0]?.tier).toBe("optional");
  });

  it("offers a topic row for a tagged note that holds no cards yet", () => {
    const deck = TestBed.inject(DeckService);

    deck.setNotes([{ note: "empty.md", cards: [], topicTags: ["#flashcards/git"] }]);

    // Tagged but unfilled is a topic the user means to tier, so it needs a row
    // even though it contributes nothing to the deck.
    expect(deck.topicTags()).toEqual(["#flashcards/git"]);
  });
});

/** A note whose cards are all overdue, so the whole set counts as backlog. */
function backlog(name: string, cards: number): ParsedNote {
  return {
    note: name,
    cards: Array.from({ length: cards }, (_, i) => ({
      front: `Q${i}`,
      back: "A",
      review: { due: "2024-01-01", interval: 5, ease: 2.5 },
    })),
    topicTags: ["#flashcards/git"],
  };
}

describe("DeckService sessions", () => {
  it("offers the next portion once the current one has been graded", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2 });
    deck.setNotes([backlog("git.md", 5)]);

    const first = [...deck.due()];
    expect(first).toHaveLength(2);

    for (const card of first) await deck.grade(card, "medium");

    // Graded cards are scheduled forward, so they leave the due set and the next
    // two take their place. This is what makes "another session" work at all —
    // the daily figure caps the queue in view, it does not lock out the day.
    expect(deck.due()).toHaveLength(2);
    expect(deck.due().map((c) => c.id)).not.toEqual(first.map((c) => c.id));
  });

  it("runs out only when nothing is left to review", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2 });
    deck.setNotes([backlog("git.md", 5)]);

    // Session after session, the backlog drains rather than being rationed.
    for (let session = 0; session < 5; session++) {
      for (const card of [...deck.due()]) await deck.grade(card, "medium");
    }

    expect(deck.due()).toHaveLength(0);
  });
});

/** A vault source backed by an in-memory note, so edits can be read back. */
function fakeSource(notes: Record<string, string>) {
  return {
    label: "Fake",
    isAvailable: () => true,
    canWrite: () => true,
    open: () => Promise.resolve(),
    readNotes: () => Promise.resolve([]),
    writeReviewState: () => Promise.resolve(),
    editNote: (path: string, transform: (md: string) => string) => {
      notes[path] = transform(notes[path] ?? "");
      return Promise.resolve();
    },
    vaultName: () => "MyVault",
    readConfig: () => Promise.resolve(DEFAULT_CONFIG),
    writeConfig: () => Promise.resolve(),
  };
}

const NOTE_MD =
  "What does grep do? :: search text <!--SR:!2026-09-01,12,250-->\n\n#flashcards/shell\n";

describe("DeckService card editing", () => {
  it("writes a correction into the note and keeps the card's review state", async () => {
    const notes = { "shell.md": NOTE_MD };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");
    deck.setNotes([parseNote(NOTE_MD, "shell.md")]);
    const card = deck.all()[0]!;

    await deck.editCard(card, { front: "What does grep actually do?", back: "search text" });

    expect(notes["shell.md"]).toContain("What does grep actually do? :: search text");
    // Correcting a typo must not cost the card its schedule.
    expect(notes["shell.md"]).toContain("<!--SR:!2026-09-01,12,250-->");
  });

  it("re-keys the edited card so the next grade finds it in the note", async () => {
    const notes = { "shell.md": NOTE_MD };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");
    deck.setNotes([parseNote(NOTE_MD, "shell.md")]);

    await deck.editCard(deck.all()[0]!, { front: "Corrected?", back: "search text" });

    // Identity is the question text, so a stale id would point at a question the
    // note no longer contains and the next write would silently do nothing.
    expect(deck.all()[0]?.id).toBe("shell.md::Corrected?");
    expect(deck.all()[0]?.front).toBe("Corrected?");
  });

  it("removes a deleted card from the note and from the deck", async () => {
    const notes = { "shell.md": NOTE_MD };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");
    deck.setNotes([parseNote(NOTE_MD, "shell.md")]);

    await deck.deleteCard(deck.all()[0]!);

    expect(notes["shell.md"]).not.toContain("What does grep do?");
    expect(notes["shell.md"]).toContain("#flashcards/shell");
    expect(deck.all()).toHaveLength(0);
  });

  it("builds an Obsidian link for the note being reviewed", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({}), "");
    deck.setNotes([parseNote(NOTE_MD, "Programming/Old Job/shell.md")]);

    expect(deck.noteLink(deck.all()[0]!)).toEqual({
      folder: "Programming/Old Job",
      uri: "obsidian://open?vault=MyVault&file=Programming%2FOld%20Job%2Fshell",
    });
  });
});

describe("DeckService cached start", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  it("keeps a grade given while the vault was still being read", async () => {
    const deck = TestBed.inject(DeckService);
    const note = parseNote(NOTE_MD, "shell.md");

    // A read that hands over its notes, then lets a grade land before finishing —
    // the shape of grading from the cached deck while the refresh is in flight.
    const grading: Promise<void>[] = [];
    const streaming = {
      ...fakeSource({ "shell.md": NOTE_MD }),
      readNotes: (onBatch?: (notes: (typeof note)[]) => void) => {
        onBatch?.([note]);
        grading.push(deck.grade(deck.all()[0]!, "easy"));
        return Promise.resolve([note]);
      },
    };

    await deck.open(streaming, "");
    await Promise.all(grading);

    // The vault already has the grade; a fresh copy of the note read before it
    // was written must not put the card back at the front of the queue.
    expect(deck.all()[0]?.review.interval).toBeGreaterThan(0);
    expect(deck.all()[0]?.review.due).not.toBe("2026-09-01");
  });
});

describe("DeckService session completion", () => {
  const TWO_CARDS = ["Q1? :: A1", "", "Q2? :: A2", "", "#flashcards/git", ""].join("\n");

  it("does not count a day as done just because a card was graded", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({ "git.md": TWO_CARDS }), "");
    deck.setNotes([parseNote(TWO_CARDS, "git.md")]);

    await deck.grade(deck.all()[0]!, "medium");

    // Grading one card and putting the phone down is exactly the day the
    // evening nudge exists for.
    expect(deck.sessionDoneToday()).toBe(false);
  });

  it("counts the day as done once a session is worked through", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({ "git.md": TWO_CARDS }), "");
    deck.setNotes([parseNote(TWO_CARDS, "git.md")]);

    await deck.completeSession();

    expect(deck.sessionDoneToday()).toBe(true);
  });

  it("records the finished day in the vault, so it survives a restart", async () => {
    const notes = { "git.md": TWO_CARDS, ".gneiss/config.md": "" };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");

    await deck.completeSession();

    expect(deck.config().lastSessionOn).not.toBe("");
  });
});
