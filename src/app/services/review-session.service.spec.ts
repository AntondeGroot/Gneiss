import { TestBed } from "@angular/core/testing";

import { DEFAULT_CONFIG, parseNote } from "../../vault";
import { DeckService } from "./deck.service";
import { ReviewSessionService } from "./review-session.service";

const FOUR = [
  "Q1? :: A1",
  "",
  "Q2? :: A2",
  "",
  "Q3? :: A3",
  "",
  "Q4? :: A4",
  "",
  "#flashcards/git",
  "",
].join("\n");

/** Stubbed rather than assumed: the test runner has no DOM storage of its own. */
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

async function loaded() {
  const deck = TestBed.inject(DeckService);
  await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 10, newPerSession: 10 });
  deck.setNotes([parseNote(FOUR, "git.md")]);
  return { deck, session: TestBed.inject(ReviewSessionService) };
}

describe("ReviewSessionService", () => {
  it("keeps its place when the review screen goes away", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");

    // Leaving is navigation: the screen is destroyed, the session is not.
    expect(session.remaining()).toBe(3);
    expect(session.unfinished()).toBe(true);
  });

  it("carries on from where it stopped rather than starting over", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");
    const next = session.current();

    session.resume();

    // The same card that was up when the session was left.
    expect(session.current()).toBe(next);
    expect(session.remaining()).toBe(3);
  });

  it("begins a new session when the last one was finished", async () => {
    const { session } = await loaded();
    session.start();
    for (let card = 0; card < 4; card++) session.grade("easy");
    expect(session.unfinished()).toBe(false);

    session.resume();

    // Nothing is due after grading everything, so there is nothing to resume to.
    expect(session.total()).toBe(0);
  });

  it("reports how far through it is", async () => {
    const { session } = await loaded();
    session.start();

    expect(session.progress()).toBe(0);
    session.grade("medium");
    expect(session.progress()).toBe(25);
  });

  it("counts a session as finished only when its last card is graded", async () => {
    const { deck, session } = await loaded();
    session.start();
    session.grade("medium");
    expect(deck.sessionDoneToday()).toBe(false);

    for (let card = 0; card < 3; card++) session.grade("medium");

    expect(deck.sessionDoneToday()).toBe(true);
  });
});

describe("ReviewSessionService across a restart", () => {
  /** A fresh service reading whatever the last one left on the device. */
  function relaunched() {
    TestBed.resetTestingModule();
    return TestBed.inject(ReviewSessionService);
  }

  it("picks the session up again after the app is closed", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");
    const where = session.current()?.id;

    const reopened = relaunched();

    // Navigating away kept the session; closing the app used to lose it.
    expect(reopened.unfinished()).toBe(true);
    expect(reopened.remaining()).toBe(3);
    expect(reopened.current()?.id).toBe(where);
  });

  it("keeps the running counts, so the tally is not restarted", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");
    session.grade("medium");

    expect(relaunched().gradedToday()).toBe(2);
  });

  it("does not pick up a session from another day", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");

    // Same payload, dated yesterday: a session is a plan for one day, and the
    // queue behind it has moved on.
    const saved = JSON.parse(store.get("gneiss.session") ?? "{}") as Record<string, unknown>;
    store.set("gneiss.session", JSON.stringify({ ...saved, day: "2020-01-01" }));

    expect(relaunched().unfinished()).toBe(false);
  });

  it("survives a session written by an older build", () => {
    store.set("gneiss.session", JSON.stringify({ day: "2020-01-01", queue: [{ id: "x" }] }));

    expect(relaunched().unfinished()).toBe(false);
  });

  it("forgets the session once its last card is graded", async () => {
    const { session } = await loaded();
    session.start();
    for (let card = 0; card < 4; card++) session.grade("easy");

    expect(store.has("gneiss.session")).toBe(false);
  });
});

describe("ReviewSessionService when the vault changes underneath", () => {
  const TAGGED = ["Q1? :: A1", "", "Q2? :: A2", "", "Q3? :: A3", "", "#flashcards/jobs", ""].join(
    "\n",
  );

  it("stops asking about cards whose note lost its tag", async () => {
    const { deck, session } = await loaded();
    deck.setNotes([parseNote(TAGGED, "jobs.md")]);
    session.start();
    expect(session.remaining()).toBe(3);

    // The vault, re-read after the tag was removed in Obsidian.
    deck.setNotes([parseNote("Q1? :: A1\n\nQ2? :: A2\n\nQ3? :: A3\n", "jobs.md")]);
    TestBed.tick();

    expect(session.remaining()).toBe(0);
  });

  it("keeps its place when cards ahead of it disappear", async () => {
    const { deck, session } = await loaded();
    const jobs = parseNote(TAGGED, "jobs.md");
    const shell = parseNote("Q4? :: A4\n\nQ5? :: A5\n\n#flashcards/shell\n", "shell.md");
    deck.setNotes([jobs, shell]);
    session.start();
    session.grade("medium");
    const here = session.current()?.id;

    // Untagged after this card, so nothing behind the reader moves.
    deck.setNotes([jobs]);
    TestBed.tick();

    expect(session.current()?.id).toBe(here);
  });

  it("shifts back when cards behind it disappear", async () => {
    const { deck, session } = await loaded();
    const jobs = parseNote(TAGGED, "jobs.md");
    const shell = parseNote("Q4? :: A4\n\nQ5? :: A5\n\n#flashcards/shell\n", "shell.md");
    deck.setNotes([jobs, shell]);
    session.start();
    session.grade("medium");
    session.grade("medium");

    deck.setNotes([shell]);
    TestBed.tick();

    // The position counts cards, not identities, so dropping two from behind
    // the reader has to move it back by two — otherwise pruning skips as many
    // cards as it removes.
    expect(session.current()?.id).toBe("shell.md::Q4?");
    expect(session.remaining()).toBe(2);
  });
});
