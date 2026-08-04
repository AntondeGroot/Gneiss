import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { parseNote } from "../../vault";
import { DeckService } from "../services/deck.service";
import { VaultScreen } from "./vault-screen";

/** Three notes across three tiers, so filtering has something to separate. */
const NOTES = [
  parseNote("What does grep do? :: search\n\n#flashcards/shell\n#core\n", "Shell/grep.md"),
  parseNote("What is a pod? :: a unit\n\n#flashcards/k8s\n", "Cloud/kubernetes.md"),
  parseNote("What is a monad? :: a burrito\n\n#flashcards/lang\n#optional\n", "Lang/haskell.md"),
];

async function shown() {
  await TestBed.configureTestingModule({
    imports: [VaultScreen],
    providers: [provideRouter([])],
  }).compileComponents();

  TestBed.inject(DeckService).setNotes(NOTES);
  const fixture = TestBed.createComponent(VaultScreen);
  fixture.detectChanges();
  return { fixture, html: fixture.nativeElement as HTMLElement };
}

function names(html: HTMLElement): string[] {
  return [...html.querySelectorAll(".note-head .name")].map((n) => n.textContent?.trim() ?? "");
}

function type(html: HTMLElement, text: string): void {
  const field = html.querySelector<HTMLInputElement>('input[name="search"]');
  if (!field) throw new Error("no search field");
  field.value = text;
  field.dispatchEvent(new Event("input"));
}

describe("VaultScreen finding a note", () => {
  it("lists every note before anything is filtered", async () => {
    const { html } = await shown();

    expect(names(html)).toHaveLength(3);
  });

  it("finds a note by part of its path", async () => {
    const { fixture, html } = await shown();

    type(html, "haskell");
    html.querySelector<HTMLButtonElement>(".search .primary")?.click();
    fixture.detectChanges();

    expect(names(html)).toEqual(["Lang/haskell.md"]);
  });

  it("waits for the button rather than filtering on every keystroke", async () => {
    const { fixture, html } = await shown();

    type(html, "haskell");
    fixture.detectChanges();

    // Refiltering hundreds of notes per keypress is work the phone can feel.
    expect(names(html)).toHaveLength(3);
  });

  it("keeps only the chosen tier", async () => {
    const { fixture, html } = await shown();

    html.querySelector<HTMLButtonElement>(".tier-choice.tier-core")?.click();
    fixture.detectChanges();

    // `#core` on the note outranks the mapping, so grep.md is the core one.
    expect(names(html)).toEqual(["Shell/grep.md"]);
  });

  it("applies the tier and the search together", async () => {
    const { fixture, html } = await shown();

    html.querySelector<HTMLButtonElement>(".tier-choice.tier-core")?.click();
    type(html, "haskell");
    html.querySelector<HTMLButtonElement>(".search .primary")?.click();
    fixture.detectChanges();

    expect(names(html)).toEqual([]);
    expect(html.textContent).toContain("Nothing matches that");
  });

  it("puts everything back when the search is cleared", async () => {
    const { fixture, html } = await shown();
    type(html, "haskell");
    html.querySelector<HTMLButtonElement>(".search .primary")?.click();
    fixture.detectChanges();

    html.querySelector<HTMLButtonElement>(".search .clear")?.click();
    fixture.detectChanges();

    expect(names(html)).toHaveLength(3);
  });
});

describe("VaultScreen with a large vault", () => {
  it("draws a trimmed list and says how much is beyond it", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultScreen],
      providers: [provideRouter([])],
    }).compileComponents();

    const many = Array.from({ length: 200 }, (_, i) =>
      parseNote(`Q${i}? :: A\n\n#flashcards/git\n`, `note-${i}.md`),
    );
    TestBed.inject(DeckService).setNotes(many);
    const fixture = TestBed.createComponent(VaultScreen);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;

    // Hundreds of rows in the DOM cost more than scrolling past them is worth.
    expect(names(html).length).toBeLessThan(200);
    expect(html.textContent).toContain("more match");
  });
});
