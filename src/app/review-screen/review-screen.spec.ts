import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { DEFAULT_CONFIG, parseNote } from "../../vault";
import { DeckService } from "../services/deck.service";
import { ReviewScreen } from "./review-screen";

const THREE = "Q1? :: A1\n\nQ2? :: A2\n\nQ3? :: A3\n\n#flashcards/git\n";

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
