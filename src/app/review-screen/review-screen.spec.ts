import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";

import { DEFAULT_CONFIG, parseNote } from "../../vault";
import type { GneissConfig, ParsedNote } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { NoteBatch, VaultSource } from "../services/vault-source";
import { ReviewScreen } from "./review-screen";

const THREE = "Q1? :: A1\n\nQ2? :: A2\n\nQ3? :: A3\n\n#flashcards/git\n";

/**
 * A vault whose write can be caught in flight.
 *
 * `editNote` hangs until `finish()` is called, which is the only way to observe
 * the window this test is about — on a real device it is the moment between
 * tapping Save and the file on disk having changed.
 */
class HeldVault implements VaultSource {
  readonly label = "Held vault";
  private finishWrite: (() => void) | null = null;

  isAvailable(): boolean {
    return true;
  }
  canWrite(): boolean {
    return true;
  }
  open(): Promise<void> {
    return Promise.resolve();
  }
  readNotes(onBatch?: NoteBatch): Promise<ParsedNote[]> {
    const notes = [parseNote(THREE, "git.md")];
    onBatch?.(notes);
    return Promise.resolve(notes);
  }
  writeReviewState(): Promise<void> {
    return Promise.resolve();
  }
  editNote(): Promise<void> {
    return new Promise((resolve) => {
      this.finishWrite = resolve;
    });
  }
  vaultName(): string {
    return "vault";
  }
  readAttachment(): Promise<string> {
    return Promise.resolve("");
  }
  readConfig(): Promise<GneissConfig> {
    return Promise.resolve(DEFAULT_CONFIG);
  }
  writeConfig(): Promise<void> {
    return Promise.resolve();
  }

  /** Lets the write that is waiting go through. */
  finish(): void {
    this.finishWrite?.();
  }
}

/**
 * Storage the tests own, cleared between them.
 *
 * A session is saved so it survives a restart, which means one test's session is
 * waiting for the next unless this is emptied. Stubbed rather than left to the
 * environment: these passed locally only because the runner had no storage at
 * all and saving quietly did nothing, then failed in CI where it does.
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

async function started() {
  await TestBed.configureTestingModule({
    imports: [ReviewScreen],
    providers: [provideRouter([])],
  }).compileComponents();

  const deck = TestBed.inject(DeckService);
  await deck.saveConfig({ ...DEFAULT_CONFIG, reviewsPerSession: 10, newPerSession: 10 });
  deck.setNotes([parseNote(THREE, "git.md")]);

  const fixture = TestBed.createComponent(ReviewScreen);
  fixture.detectChanges();
  const html = fixture.nativeElement as HTMLElement;
  html.querySelector<HTMLButtonElement>("button.primary")?.click();
  fixture.detectChanges();
  return { fixture, deck, html };
}

function fillWidth(html: HTMLElement): string {
  return html.querySelector<HTMLElement>(".progress .fill")?.style.width ?? "";
}

describe("ReviewScreen progress", () => {
  it("starts empty and fills as cards are graded", async () => {
    const { fixture, html } = await started();

    expect(fillWidth(html)).toBe("0%");

    html.querySelector<HTMLButtonElement>("button.primary")?.click();
    fixture.detectChanges();
    [...html.querySelectorAll<HTMLButtonElement>("button.grade")][1]?.click();
    fixture.detectChanges();

    // One of three graded.
    expect(fillWidth(html)).toBe("33%");
  });

  it("reports where the session is up to, for anyone not looking at it", async () => {
    const { html } = await started();

    const bar = html.querySelector(".progress");
    expect(bar?.getAttribute("role")).toBe("progressbar");
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("offers a way out of the session", async () => {
    const { html } = await started();

    // The tab bar is hidden while reviewing, so without this there is none.
    expect(html.querySelector("button.leave")).not.toBeNull();
  });
});

describe("ReviewScreen resuming", () => {
  it("carries on with an open session instead of showing Start again", async () => {
    const { fixture, html } = await started();
    html.querySelector<HTMLButtonElement>("button.primary")?.click();
    fixture.detectChanges();
    [...html.querySelectorAll<HTMLButtonElement>("button.grade")][1]?.click();
    fixture.detectChanges();

    // Leaving destroys the screen; coming back builds a new one.
    fixture.destroy();
    const returned = TestBed.createComponent(ReviewScreen);
    returned.detectChanges();
    const back = returned.nativeElement as HTMLElement;

    // Straight into the card, with the progress it already had.
    expect(back.querySelector("section.card")).not.toBeNull();
    expect(back.querySelector<HTMLElement>(".progress .fill")?.style.width).toBe("33%");
  });
});

describe("ReviewScreen when the session is done", () => {
  /** Grades every card, which is what puts the finished panel up. */
  async function finished() {
    const started_ = await started();
    for (let card = 0; card < 3; card++) {
      started_.html.querySelector<HTMLButtonElement>("button.primary")?.click();
      started_.fixture.detectChanges();
      [...started_.html.querySelectorAll<HTMLButtonElement>("button.grade")][1]?.click();
      started_.fixture.detectChanges();
    }
    return started_;
  }

  it("offers leaving as a button, not as a link to read past", async () => {
    const { html } = await finished();

    expect(html.querySelector("button.secondary")?.textContent?.trim()).toBe("Back to Today");
    expect(html.querySelector("section.intro a")).toBeNull();
  });

  it("goes to Today, which is where the day's state is", async () => {
    const { fixture, html } = await finished();
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);

    html.querySelector<HTMLButtonElement>("button.secondary")?.click();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(["/today"]);
  });
});

describe("ReviewScreen editing", () => {
  /** Reveals the answer, which is when the ✎ appears. */
  async function shown() {
    const opened = await started();
    opened.html.querySelector<HTMLButtonElement>("button.primary")?.click();
    opened.fixture.detectChanges();
    return opened;
  }

  function press(html: HTMLElement, selector: string): void {
    html.querySelector<HTMLButtonElement>(selector)?.click();
  }

  /** A button inside the question, not the identically-named one behind it. */
  function inDialog(html: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...html.querySelectorAll<HTMLButtonElement>(".ask button")].find(
      (button) => button.textContent?.trim() === label,
    );
  }

  /** Drains the promises a save runs through before the editor can close. */
  function settled(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function type(html: HTMLElement, text: string): void {
    const box = html.querySelector<HTMLTextAreaElement>("textarea[name='front']");
    if (!box) throw new Error("no question box");
    box.value = text;
    box.dispatchEvent(new Event("input"));
  }

  it("keeps the editor open until the note has actually been written", async () => {
    const vault = new HeldVault();
    const { fixture, deck, html } = await shown();
    await deck.open(vault, "vault");

    press(html, "button.edit");
    fixture.detectChanges();
    type(html, "A better question?");
    fixture.detectChanges();

    press(html, "gn-card-editor button.primary");
    await settled();
    fixture.detectChanges();

    // The write is still in flight. Saving used to be fired and forgotten, so the
    // editor shut here — with its own link to open the note in Obsidian, which is
    // handing a file to another program in the middle of rewriting it.
    expect(html.querySelector("gn-card-editor")).not.toBeNull();
    expect(html.textContent).toContain("Saving to the note");

    vault.finish();
    await settled();
    fixture.detectChanges();

    expect(html.querySelector("gn-card-editor")).toBeNull();
  });

  it("closes on a second press, having opened on the first", async () => {
    const { fixture, html } = await shown();

    press(html, "button.edit");
    fixture.detectChanges();
    expect(html.querySelector("gn-card-editor")).not.toBeNull();

    press(html, "button.edit");
    fixture.detectChanges();
    expect(html.querySelector("gn-card-editor")).toBeNull();
  });

  it("asks before dropping edits, rather than closing on them", async () => {
    const { fixture, html } = await shown();
    press(html, "button.edit");
    fixture.detectChanges();

    type(html, "A better question?");
    fixture.detectChanges();
    press(html, "button.edit");
    fixture.detectChanges();

    // Still open, now with the question up.
    expect(html.querySelector("gn-card-editor")).not.toBeNull();
    expect(html.textContent).toContain("Keep your changes");
  });

  it("saves from the prompt, so the way out is not only losing the edit", async () => {
    const { fixture, html } = await shown();
    press(html, "button.edit");
    fixture.detectChanges();
    type(html, "A better question?");
    fixture.detectChanges();
    press(html, "button.edit");
    fixture.detectChanges();

    inDialog(html, "Save")?.click();
    // Closing now waits on the note actually being written, so the editor is
    // still up for as long as the write is in flight.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(html.querySelector("gn-card-editor")).toBeNull();
    expect(html.textContent).toContain("A better question?");
  });

  it("goes back to the draft on keep editing, losing nothing", async () => {
    const { fixture, html } = await shown();
    press(html, "button.edit");
    fixture.detectChanges();
    type(html, "A better question?");
    fixture.detectChanges();
    press(html, "button.edit");
    fixture.detectChanges();

    inDialog(html, "Keep editing")?.click();
    fixture.detectChanges();

    expect(html.querySelector(".ask")).toBeNull();
    expect(html.querySelector("gn-card-editor")).not.toBeNull();
    expect(html.querySelector<HTMLTextAreaElement>("textarea[name='front']")?.value).toBe(
      "A better question?",
    );
  });

  it("closes on discard, leaving the card as the note has it", async () => {
    const { fixture, html } = await shown();
    press(html, "button.edit");
    fixture.detectChanges();
    type(html, "A better question?");
    fixture.detectChanges();
    press(html, "button.edit");
    fixture.detectChanges();

    inDialog(html, "Discard")?.click();
    fixture.detectChanges();

    expect(html.querySelector("gn-card-editor")).toBeNull();
    expect(html.textContent).toContain("Q1?");
  });
});
