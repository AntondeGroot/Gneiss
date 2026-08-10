import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";

import { DEFAULT_CONFIG, addDays, parseNote } from "../../vault";
import { DeckService } from "../services/deck.service";
import { today } from "../services/clock.service";
import { SettingsScreen } from "./settings-screen";

/** A vault carrying the two tags these exams are scoped to. */
const NOTES = [
  parseNote("Q? :: A\n\n#flashcards/Java\n", "java.md"),
  parseNote("Q? :: A\n\n#flashcards/Angular\n", "angular.md"),
];

// Relative to today, because the dialog refuses a date that has been and gone —
// a hard-coded one would pass until it quietly became the past.
const SOON = addDays(today(), 20);
const MOVED = addDays(today(), 25);
const LATER = addDays(today(), 30);

async function open(crams = DEFAULT_CONFIG.crams) {
  await TestBed.configureTestingModule({
    imports: [SettingsScreen],
    providers: [provideRouter([])],
  }).compileComponents();

  const deck = TestBed.inject(DeckService);
  await deck.saveConfig({ ...DEFAULT_CONFIG, crams });
  deck.setNotes(NOTES);

  const fixture = TestBed.createComponent(SettingsScreen);
  fixture.detectChanges();
  return { fixture, deck, html: fixture.nativeElement as HTMLElement };
}

function exams(html: HTMLElement): HTMLElement[] {
  return [...html.querySelectorAll<HTMLElement>(".exam")];
}

function dialog(html: HTMLElement): HTMLElement | null {
  return html.querySelector<HTMLElement>("gn-exam-dialog");
}

function type(html: HTMLElement, name: string, value: string): void {
  const field = html.querySelector<HTMLInputElement>(`gn-exam-dialog input[name="${name}"]`);
  if (!field) throw new Error(`no field named ${name}`);
  field.value = value;
  field.dispatchEvent(new Event("input"));
}

function press(html: HTMLElement, selector: string, at = 0): void {
  [...html.querySelectorAll<HTMLButtonElement>(selector)][at]?.click();
}

describe("SettingsScreen exams", () => {
  it("starts with none, and says so rather than showing an empty form", async () => {
    const { html } = await open();

    expect(exams(html)).toHaveLength(0);
    expect(html.textContent).toContain("No exams");
  });

  it("asks in a dialog rather than dropping a blank row into the list", async () => {
    const { fixture, html } = await open();

    press(html, "button.add");
    fixture.detectChanges();

    // Nothing joins the list until the dialog has checked it — which is what
    // lets a row be a summary instead of a form.
    expect(dialog(html)).not.toBeNull();
    expect(exams(html)).toHaveLength(0);
  });

  it("adds the exam the dialog vouched for, and puts the dialog away", async () => {
    const { fixture, html } = await open();

    press(html, "button.add");
    fixture.detectChanges();
    type(html, "examScope", "#flashcards/Java");
    type(html, "examDate", SOON);
    fixture.detectChanges();
    press(html, "gn-exam-dialog button.primary");
    fixture.detectChanges();

    expect(exams(html)).toHaveLength(1);
    expect(exams(html)[0]?.textContent).toContain("#flashcards/Java");
    expect(dialog(html)).toBeNull();
  });

  it("edits the exam whose row was opened, in place rather than onto the end", async () => {
    const week = [
      { scope: "#flashcards/Java", examDate: SOON, perSession: 10 },
      { scope: "#flashcards/Angular", examDate: LATER, perSession: 8 },
    ];
    const { fixture, html } = await open(week);

    press(html, "button.exam-open", 0);
    fixture.detectChanges();
    await fixture.whenStable();
    type(html, "examDate", MOVED);
    fixture.detectChanges();
    press(html, "gn-exam-dialog button.primary");
    fixture.detectChanges();

    expect(exams(html)).toHaveLength(2);
    expect(exams(html)[0]?.textContent).toContain(MOVED);
    // The one nobody opened is untouched, and still second.
    expect(exams(html)[1]?.textContent).toContain(LATER);
  });

  it("removes the exam whose button was pressed, not the last one", async () => {
    const week = [
      { scope: "#flashcards/Java", examDate: SOON, perSession: 10 },
      { scope: "#flashcards/Angular", examDate: LATER, perSession: 8 },
    ];
    const { fixture, html } = await open(week);

    press(html, "button.drop", 0);
    fixture.detectChanges();

    // Asserted on the row, not the whole screen: the tag also names a row in
    // the tier table, which would answer to either name.
    expect(exams(html)).toHaveLength(1);
    expect(exams(html)[0]?.textContent).toContain("#flashcards/Angular");
    expect(exams(html)[0]?.textContent).not.toContain("#flashcards/Java");
  });

  it("saves the exams to the vault, so a deletion is not just on screen", async () => {
    const { fixture, deck, html } = await open([
      { scope: "#flashcards/Java", examDate: SOON, perSession: 10 },
    ]);

    press(html, "button.drop");
    fixture.detectChanges();
    press(html, "button.primary");
    await fixture.whenStable();

    expect(deck.config().crams).toEqual([]);
  });
});
