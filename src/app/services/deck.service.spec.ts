import { TestBed } from "@angular/core/testing";

import { DEFAULT_CONFIG, parseNote } from "../../vault";
import type { ParsedNote, Tier } from "../../vault";

import { DeckService } from "./deck.service";

function note(name: string, topicTags: string[], tierOverride?: Tier): ParsedNote {
  return {
    note: name,
    cards: [{ front: "Question?", back: "Answer", occurrence: 0 }],
    topicTags,
    ...(tierOverride ? { tierOverride } : {}),
  };
}

/**
 * Storage the tests own, cleared between them.
 *
 * At file scope on purpose: grading writes the deck to the cache, so a block
 * left on the environment's own storage picks up whatever the last test left.
 * A runner without storage hides that entirely — which is how this passed
 * locally and failed in CI.
 */
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
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
      occurrence: 0,
      review: { due: "2024-01-01", interval: 5, ease: 2.5 },
    })),
    topicTags: ["#flashcards/git"],
  };
}

describe("DeckService sessions", () => {
  it("offers the next portion once the current one has been graded", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2, newPerSession: 0 });
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
    await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 2, newPerSession: 0 });
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
    readAttachment: () => Promise.resolve(""),
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
    expect(deck.all()[0]?.id).toBe("shell.md::Corrected?#0");
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

describe("DeckService opening twice", () => {
  const TWO = "Q1? :: A1\n\nQ2? :: A2\n\n#flashcards/git\n";

  /**
   * Lists before it reads, like the real one.
   *
   * The delay before the first batch is the whole point: on a device the walk
   * spends about a second listing the vault, so a second caller arriving in that
   * window still sees an empty deck and starts streaming into it as well.
   */
  function slowSource(note: ParsedNote) {
    return {
      ...fakeSource({}),
      readNotes: (onBatch?: (notes: ParsedNote[]) => void) =>
        new Promise<ParsedNote[]>((resolve) => {
          setTimeout(() => onBatch?.([note]), 10);
          setTimeout(() => resolve([note]), 60);
        }),
    };
  }

  it("does not serve a card twice while two screens open the same vault", async () => {
    const deck = TestBed.inject(DeckService);
    const note = parseNote(TWO, "git.md");
    const source = slowSource(note);

    // App reopens at launch and the Vault screen used to reopen on arrival.
    const first = deck.open(source, "vault");
    const second = deck.open(source, "vault");
    // After the batch has landed, before either read has finished.
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Checked *during* the read, which is when reviewing happens — the final
    // state was always right, because the last read replaces the deck wholesale.
    expect(deck.all().map((card) => card.id)).toEqual(["git.md::Q1?#0", "git.md::Q2?#0"]);
    await Promise.all([first, second]);
  });

  it("keeps one card per id even if a note arrives twice", async () => {
    const deck = TestBed.inject(DeckService);
    const note = parseNote(TWO, "git.md");
    await deck.open(fakeSource({}), "");

    deck.addNotes([note]);
    deck.addNotes([note]);

    expect(deck.all()).toHaveLength(2);
  });

  it("still keeps two notes that happen to ask the same question", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({}), "");

    deck.addNotes([parseNote(TWO, "git.md"), parseNote(TWO, "copy/git.md")]);

    // Different files are different cards, however alike they read.
    expect(deck.all()).toHaveLength(4);
  });
});

describe("DeckService and the flashcards tag", () => {
  it("ignores a note that carries cards but no tag", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({}), "");

    deck.setNotes([
      parseNote("What is a STAR answer? :: Situation, Task, Action, Result\n", "job-seeking.md"),
      parseNote("What does grep do? :: search\n\n#flashcards/shell\n", "grep.md"),
    ]);

    // A `::` can appear in any note; the tag is what opts one in.
    expect(deck.all().map((card) => card.note)).toEqual(["grep.md"]);
  });

  it("drops the cards when a note loses its tag", async () => {
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({}), "");
    const tagged = "Do I want this job? :: no\n\n#flashcards/jobs\n";
    deck.setNotes([parseNote(tagged, "jobs.md")]);
    expect(deck.all()).toHaveLength(1);

    // The same note, re-read after the tag was removed in Obsidian.
    deck.setNotes([parseNote("Do I want this job? :: no\n", "jobs.md")]);

    expect(deck.all()).toHaveLength(0);
  });
});

describe("DeckService setting a note's tier", () => {
  const NOTE = "What does grep do? :: search\n\n#flashcards/shell\n";

  it("writes the tag into the note", async () => {
    const notes = { "grep.md": NOTE };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");
    deck.setNotes([parseNote(NOTE, "grep.md")]);

    await deck.setTier("grep.md", "core");

    expect(notes["grep.md"]).toContain("#core");
    expect(deck.all()[0]?.tier).toBe("core");
  });

  it("removes the tag for standard, because standard is its absence", async () => {
    const tagged = "What does grep do? :: search\n\n#flashcards/shell\n#core\n";
    const notes = { "grep.md": tagged };
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource(notes), "");
    deck.setNotes([parseNote(tagged, "grep.md")]);

    await deck.setTier("grep.md", "standard");

    expect(notes["grep.md"]).not.toContain("#core");
    expect(notes["grep.md"]).toContain("#flashcards/shell");
  });

  it("lets the mapping decide again once the override is removed", async () => {
    const tagged = "What does grep do? :: search\n\n#flashcards/shell\n#optional\n";
    const deck = TestBed.inject(DeckService);
    await deck.open(fakeSource({ "grep.md": tagged }), "");
    await deck.saveConfig({ ...DEFAULT_CONFIG, tiers: { "#flashcards/shell": "core" } });
    deck.setNotes([parseNote(tagged, "grep.md")]);
    expect(deck.all()[0]?.tier).toBe("optional");

    await deck.setTier("grep.md", "standard");

    // Choosing "standard" clears the override; the mapping then says core, and
    // showing "standard" would be a lie about what the card will do.
    expect(deck.all()[0]?.tier).toBe("core");
  });
});

/** The grace the midnight tick allows itself, so it cannot fire a hair early. */
const SETTLE_MS = 1000;

/** Nothing to do on the 10th: this card is not wanted until the 11th. */
const DUE_ON_THE_ELEVENTH =
  "What does grep do? :: search text <!--SR:!2026-08-11,3,250-->\n\n#flashcards/git\n";

describe("DeckService across midnight", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads the due set when the day rolls over, without being asked again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 23, 59, 30));
    const deck = TestBed.inject(DeckService);
    await deck.saveConfig(DEFAULT_CONFIG);
    deck.setNotes([parseNote(DUE_ON_THE_ELEVENTH, "git.md")]);

    expect(deck.due()).toHaveLength(0);

    // Thirty seconds to midnight, and nothing else happens: no grade, no
    // reload, no navigation. That is the point — `due` is a computed, so while
    // the date was a plain function call it stayed frozen on the 10th and this
    // stayed empty however long the app was left open.
    vi.advanceTimersByTime(30_000 + SETTLE_MS);

    expect(deck.due()).toHaveLength(1);
  });
});
