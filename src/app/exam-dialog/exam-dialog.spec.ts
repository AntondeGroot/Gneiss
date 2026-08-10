import { TestBed } from "@angular/core/testing";

import { DEFAULT_CRAM_PER_SESSION } from "../../vault";
import type { CramState } from "../../vault";
import { ExamDialog } from "./exam-dialog";

const TODAY = "2026-08-10";

/** A vault where the only tags written on notes are two levels deep. */
const VAULT_TAGS = [
  "#flashcards/Java/OCP",
  "#flashcards/Java/Streams",
  "#flashcards/git",
  "#flashcards/vim",
];

async function open(inputs: { exam?: CramState | null; topics?: readonly string[] } = {}) {
  await TestBed.configureTestingModule({ imports: [ExamDialog] }).compileComponents();

  const fixture = TestBed.createComponent(ExamDialog);
  fixture.componentRef.setInput("today", TODAY);
  fixture.componentRef.setInput("topics", inputs.topics ?? VAULT_TAGS);
  fixture.componentRef.setInput("exam", inputs.exam ?? null);

  const saved: CramState[] = [];
  fixture.componentInstance.save.subscribe((exam) => saved.push(exam));

  fixture.detectChanges();
  return { fixture, saved, html: fixture.nativeElement as HTMLElement };
}

function field(html: HTMLElement, name: string): HTMLInputElement {
  const found = html.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!found) throw new Error(`no field named ${name}`);
  return found;
}

function scopeField(html: HTMLElement): HTMLInputElement {
  return field(html, "examScope");
}

/** Types into a field the way a user does — the value accessor, not the signal. */
function type(html: HTMLElement, name: string, value: string): void {
  const target = field(html, name);
  target.value = value;
  target.dispatchEvent(new Event("input"));
}

function press(html: HTMLElement, selector: string): void {
  html.querySelector<HTMLButtonElement>(selector)?.click();
}

function suggestions(html: HTMLElement): string[] {
  return [...html.querySelectorAll<HTMLElement>(".suggestions button")].map(
    (tag) => tag.textContent?.trim() ?? "",
  );
}

function problems(html: HTMLElement): string[] {
  return [...html.querySelectorAll<HTMLElement>(".problem")].map(
    (p) => p.textContent?.trim() ?? "",
  );
}

describe("ExamDialog", () => {
  it("refuses a scope no tag in the vault falls under", async () => {
    const { fixture, html, saved } = await open();

    type(html, "examScope", "#flashcards/Jva");
    type(html, "examDate", "2026-09-01");
    fixture.detectChanges();

    // Said as it is typed, not held back until Add: the tag is wrong now.
    expect(problems(html)).toContain(
      "No card in the vault is tagged #flashcards/Jva. Pick one of the vault's own tags.",
    );

    press(html, "button.primary");
    expect(saved).toEqual([]);
  });

  it("narrows the vault's tags to the segment typed, and fills the field from the one picked", async () => {
    const { fixture, html } = await open();

    // Not "#flashcards/vi": the prefix every tag shares is the part nobody wants
    // to type, so a bare segment has to find it.
    type(html, "examScope", "vi");
    fixture.detectChanges();

    expect(suggestions(html)).toEqual(["#flashcards/vim"]);
    // Being mid-way through typing a tag is not yet a mistake, so nothing red.
    expect(problems(html)).toEqual([]);

    press(html, ".suggestions button");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(scopeField(html).value).toBe("#flashcards/vim");
    // Taken: the list stands down rather than repeating the answer underneath.
    expect(suggestions(html)).toEqual([]);
  });

  it("takes a parent scope no note carries, when subtopics fall under it", async () => {
    const { fixture, html, saved } = await open();

    // Why the field is typed and not chosen from a list: `#flashcards/Java` is
    // exactly how you cram for one exam across its subtopics, and no note is
    // tagged with it.
    type(html, "examScope", "#flashcards/Java");
    type(html, "examDate", "2026-09-01");
    fixture.detectChanges();

    expect(html.textContent).toContain("Covers 2 tags in the vault.");

    press(html, "button.primary");
    expect(saved).toEqual([
      { scope: "#flashcards/Java", examDate: "2026-09-01", perSession: DEFAULT_CRAM_PER_SESSION },
    ]);
  });

  it("says nothing about empty fields until Add is pressed, then names them", async () => {
    const { fixture, html, saved } = await open();

    // Opening the dialog is not yet a mistake to be told off for.
    expect(problems(html)).toEqual([]);

    press(html, "button.primary");
    fixture.detectChanges();

    expect(problems(html)).toEqual([
      "Name the topic tag this exam covers.",
      "Pick the day of the exam.",
    ]);
    expect(saved).toEqual([]);
  });

  it("refuses a date today or past, which would clamp nothing", async () => {
    const { fixture, html, saved } = await open();

    type(html, "examScope", "#flashcards/git");
    type(html, "examDate", TODAY);
    fixture.detectChanges();

    expect(problems(html)).toEqual([
      "The exam has to be at least a day away — one today or past focuses nothing.",
    ]);

    press(html, "button.primary");
    expect(saved).toEqual([]);
  });

  it("takes the tag on trust when the vault has not been read", async () => {
    const { fixture, html, saved } = await open({ topics: [] });

    type(html, "examScope", "#flashcards/whatever");
    type(html, "examDate", "2026-09-01");
    fixture.detectChanges();

    // Blocking here would refuse an exam over the app's own state, not a mistake.
    expect(html.textContent).toContain("The vault has not been read yet");

    press(html, "button.primary");
    expect(saved).toHaveLength(1);
  });

  it("opens on the exam being edited, and keeps the fields left alone", async () => {
    const exam = { scope: "#flashcards/git", examDate: "2026-09-01", perSession: 8 };
    const { fixture, html, saved } = await open({ exam });
    await fixture.whenStable();

    expect(html.textContent).toContain("Edit exam");
    expect(scopeField(html).value).toBe("#flashcards/git");

    type(html, "examDate", "2026-09-05");
    fixture.detectChanges();
    press(html, "button.primary");

    // The pace was not touched, so it rides along at 8 rather than resetting.
    expect(saved).toEqual([{ scope: "#flashcards/git", examDate: "2026-09-05", perSession: 8 }]);
  });
});
