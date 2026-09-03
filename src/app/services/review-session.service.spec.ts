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

  it("remembers which card was already put off", async () => {
    const { session } = await loaded();
    session.start();
    session.skip();

    const reopened = relaunched();
    reopened.grade("medium");
    reopened.grade("medium");
    reopened.grade("medium");

    // The restored queue already has the card at the back, so without the ban
    // surviving too it could be sent round again, and again, indefinitely.
    expect(reopened.current()?.id).toBe("git.md::Q1?#0");
    expect(reopened.canSkip()).toBe(false);
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
    expect(session.current()?.id).toBe("shell.md::Q4?#0");
    expect(session.remaining()).toBe(2);
  });
});

describe("ReviewSessionService putting a card off", () => {
  it("sends a skipped card to the back and carries on", async () => {
    const { session } = await loaded();
    session.start();
    expect(session.current()?.id).toBe("git.md::Q1?#0");

    session.skip();

    // The position does not move — the card behind slides into it — so the next
    // question is up straight away. Nothing was answered, so the queue is still
    // four long and the progress bar has not budged.
    expect(session.current()?.id).toBe("git.md::Q2?#0");
    expect(session.remaining()).toBe(4);
    expect(session.progress()).toBe(0);

    // At the back, not merely somewhere later: the other three come first.
    session.grade("medium");
    session.grade("medium");
    session.grade("medium");
    expect(session.current()?.id).toBe("git.md::Q1?#0");
  });

  it("refuses a second skip of the same card", async () => {
    const { session } = await loaded();
    session.start();
    session.skip();

    // Round the queue to meet it again.
    session.grade("medium");
    session.grade("medium");
    session.grade("medium");
    expect(session.current()?.id).toBe("git.md::Q1?#0");

    // A card that could be put off every time it came round would never be
    // answered, so the offer is gone and pressing anyway changes nothing.
    expect(session.canSkip()).toBe(false);
    session.skip();
    expect(session.current()?.id).toBe("git.md::Q1?#0");
  });

  it("does not offer to skip the last card standing", async () => {
    const { session } = await loaded();
    session.start();
    session.grade("medium");
    session.grade("medium");
    session.grade("medium");
    expect(session.remaining()).toBe(1);

    // Moving the only card left to the back lands it exactly where it is, so
    // the offer would be a button that visibly does nothing.
    expect(session.canSkip()).toBe(false);
  });

  it("does not count a skip as a grade", async () => {
    const { session } = await loaded();
    session.start();
    const before = session.current()?.review;

    session.skip();

    // Putting a card off is free: it settles nothing, so neither tally counts
    // it and the streak and the evening nudge are untouched.
    expect(session.graded()).toBe(0);
    expect(session.gradedToday()).toBe(0);

    // And it claims nothing — the schedule in the note is exactly as it was, so
    // the card is still just as due as before it was passed over.
    session.grade("medium");
    session.grade("medium");
    session.grade("medium");
    expect(session.current()?.review).toEqual(before);
  });

  it("lets a new session put the same card off again", async () => {
    const { session } = await loaded();
    session.start();
    session.skip();
    session.grade("medium");
    session.grade("medium");

    // A second sitting re-reads what is due and builds its own queue, which the
    // last one's order says nothing about — so the ban goes with it.
    session.start();

    expect(session.current()?.id).toBe("git.md::Q1?#0");
    expect(session.canSkip()).toBe(true);
  });

  it("keeps the card banned when its question is corrected", async () => {
    const { session } = await loaded();
    session.start();
    session.skip();
    // Two put off, so reaching the first one again does not also make it the
    // last card standing — which would refuse the skip for the wrong reason.
    session.skip();
    session.grade("medium");
    session.grade("medium");
    expect(session.current()?.id).toBe("git.md::Q1?#0");
    expect(session.remaining()).toBe(2);

    await session.edit({ front: "Q1 corrected?", back: "A1" });

    // The id is derived from the question, so the edit mints a new one. Fixing
    // a typo is not a way to be handed a second skip.
    expect(session.current()?.id).toBe("git.md::Q1 corrected?#0");
    expect(session.canSkip()).toBe(false);
  });
});
