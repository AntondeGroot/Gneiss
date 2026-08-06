import { Component, computed, effect, inject, signal, viewChild } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { CardBody } from "../card-body/card-body";
import { CardEditor } from "../card-editor/card-editor";

import type { CardText, Grade } from "../../vault";
import { DeckService } from "../services/deck.service";
import { ReviewSessionService } from "../services/review-session.service";

const GRADES: readonly Grade[] = ["difficult", "medium", "easy"];

@Component({
  selector: "gn-review-screen",
  imports: [RouterLink, CardBody, CardEditor],
  templateUrl: "./review-screen.html",
  styleUrl: "./review-screen.scss",
})
export class ReviewScreen {
  private readonly deck = inject(DeckService);
  private readonly session = inject(ReviewSessionService);
  private readonly router = inject(Router);

  protected readonly grades = GRADES;
  protected readonly revealed = signal(false);
  protected readonly started = signal(false);

  protected readonly current = this.session.current;
  protected readonly remaining = this.session.remaining;
  protected readonly progress = this.session.progress;
  protected readonly graded = this.session.graded;
  protected readonly sessions = this.session.sessions;
  protected readonly gradedAcrossSessions = this.session.gradedToday;

  protected readonly dueCount = computed(() => this.deck.due().length);
  protected readonly writeError = this.deck.writeError;
  protected readonly finished = computed(() => this.started() && this.current() === null);

  /** Whether the correction box is open over the current card. */
  protected readonly editing = signal(false);

  /** The open editor, so the ✎ can ask it whether closing is safe. */
  private readonly editor = viewChild(CardEditor);

  /** Where the note lives, and the link that hands over to Obsidian. */
  protected readonly link = computed(() => {
    const card = this.current();
    return card ? this.deck.noteLink(card) : { folder: "", uri: "" };
  });

  constructor() {
    // Warms this card's answer while the question is up, and the next card's
    // while this one is being answered — so an image is rarely waited on.
    effect(() => {
      this.deck.prefetch(...this.session.upcoming());
    });

    // Arriving with a session already open carries it on. Today sends people
    // here to *continue*, and starting again from the top would undo that.
    if (this.session.unfinished()) this.started.set(true);
  }

  protected start(): void {
    this.session.start();
    this.revealed.set(false);
    this.started.set(true);
  }

  /**
   * Leaves mid-session, keeping everything graded so far.
   *
   * Nothing needs saving: a grade is written to its note as it is given, and the
   * queue lives in the session rather than on this screen, so what is left is
   * still there on the way back.
   */
  protected leave(): void {
    void this.router.navigate(["/today"]);
  }

  protected reveal(): void {
    this.revealed.set(true);
  }

  /**
   * The ✎ both opens and closes, so pressing it twice undoes the first press.
   *
   * Closing goes through the editor rather than round it: it holds the draft, so
   * it is the only part that knows whether anything would be lost — and if so it
   * puts the question up instead of shutting.
   */
  protected toggleEditor(): void {
    if (this.editing()) this.editor()?.requestClose();
    else this.editing.set(true);
  }

  protected closeEditor(): void {
    this.editing.set(false);
  }

  protected saveEdit(next: CardText): void {
    this.session.edit(next);
    this.closeEditor();
  }

  protected deleteCard(): void {
    this.session.remove();
    this.closeEditor();
    this.revealed.set(false);
  }

  /** When this grade would bring the card back, computed live from the settings. */
  protected preview(grade: Grade): string {
    const card = this.current();
    return card ? describeInterval(this.deck.preview(card, grade).interval) : "";
  }

  protected grade(grade: Grade): void {
    this.session.grade(grade);
    this.revealed.set(false);
  }
}

function describeInterval(days: number): string {
  if (days <= 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 14) return "in a week";
  if (days < 45) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}
