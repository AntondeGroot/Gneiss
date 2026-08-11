import { NoteWriter } from "./note-writer";

/** Long enough for anything queued behind to run first, if it were allowed to. */
const slow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("NoteWriter", () => {
  it("stays busy from the moment a write is queued until the last one is done", async () => {
    const writer = new NoteWriter();

    const first = writer.write("git.md", () => slow());
    const second = writer.write("git.md", () => Promise.resolve());

    // Queued counts as busy, not just running: a note about to be rewritten is
    // no safer to open in Obsidian than one being rewritten now.
    expect(writer.writing("git.md")).toBe(true);

    await first;
    // A note written twice has to stay busy for both, or the way out to Obsidian
    // comes back between them — which is the middle of the same rewrite.
    expect(writer.writing("git.md")).toBe(true);

    await second;
    expect(writer.writing("git.md")).toBe(false);
  });

  it("lets a write to another note go ahead rather than queue behind", async () => {
    const writer = new NoteWriter();
    const order: string[] = [];

    const git = writer.write("git.md", async () => {
      order.push("git starts");
      await slow();
      order.push("git finishes");
    });
    const vim = writer.write("vim.md", () => {
      order.push("vim writes");
      return Promise.resolve();
    });

    await Promise.all([git, vim]);

    // The exact opposite of one note's two writes, and deliberately so: they
    // cannot read each other's file, so there is nothing to serialise. One queue
    // for the whole vault would put every grade in a session behind the slowest
    // write in it.
    expect(order).toEqual(["git starts", "vim writes", "git finishes"]);
  });

  it("records a failure and still runs what was queued behind it", async () => {
    const writer = new NoteWriter();
    const ran: string[] = [];

    const failed = writer.write("git.md", () => Promise.reject(new Error("read-only folder")));
    const next = writer.write("git.md", () => {
      ran.push("second");
      return Promise.resolve();
    });

    await failed;
    // Reported rather than thrown: a write that cannot land must not take down
    // the review, and the screen says so instead of quietly losing the grade.
    expect(writer.error()).toBe("read-only folder");

    await next;
    // The tail a write is chained on must never carry a rejection, or one failure
    // would settle every later write to that note without any being attempted —
    // a note that stops being written to for the rest of the session.
    expect(ran).toEqual(["second"]);
  });

  it("holds a second write to one note until the first has finished", async () => {
    const writer = new NoteWriter();
    const order: string[] = [];

    const first = writer.write("git.md", async () => {
      order.push("first reads");
      await slow();
      order.push("first writes");
    });
    const second = writer.write("git.md", () => {
      order.push("second reads");
      return Promise.resolve();
    });

    await Promise.all([first, second]);

    // Every write is read-modify-write against the file on disk. Overlapping,
    // the second reads the note before the first has written it and puts back a
    // copy that never saw it — the grade the first was recording, gone.
    expect(order).toEqual(["first reads", "first writes", "second reads"]);
  });
});
