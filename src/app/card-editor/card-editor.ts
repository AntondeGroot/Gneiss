import { Component, effect, input, linkedSignal, output, signal, viewChild } from "@angular/core";
import type { ElementRef } from "@angular/core";
import { FormsModule } from "@angular/forms";

import type { CardText } from "../../vault";

/**
 * Correcting a card without leaving the review.
 *
 * Deliberately presentational: it knows a question, an answer and where the note
 * lives, and reports what the user asked for. Nothing about vaults, sources or
 * scheduling reaches in here, so it can sit on any screen showing a card.
 */
@Component({
  selector: "gn-card-editor",
  imports: [FormsModule],
  templateUrl: "./card-editor.html",
  styleUrl: "./card-editor.scss",
  // Escape is what a dialog answers to, and it takes the safe way out: back to
  // the editor with the draft intact, never the one that throws work away.
  host: { "(document:keydown.escape)": "keepEditing()" },
})
export class CardEditor {
  readonly front = input.required<string>();
  readonly back = input.required<string>();
  /** Where the note sits in the vault, and the link that opens it in Obsidian. */
  readonly folder = input("");
  readonly noteUri = input("");
  readonly notePath = input("");
  /**
   * Whether the note is being written at this moment.
   *
   * The way out to Obsidian is withheld while it is. Opening the note there
   * mid-write is how two programs come to hold different versions of one file,
   * and the sync the vault rides on can only keep both.
   */
  readonly saving = input(false);

  readonly save = output<CardText>();
  readonly remove = output<void>();
  readonly dismissed = output<void>();

  /**
   * Seeded from the card and writable on top — `linkedSignal` rather than a
   * plain one because the inputs are not bound yet when fields initialise.
   */
  protected readonly draftFront = linkedSignal(() => this.front());
  protected readonly draftBack = linkedSignal(() => this.back());

  /** Deleting is a two-step: the trash button arms it, a second press confirms. */
  protected readonly confirmingDelete = signal(false);

  /** Whether closing is waiting on an answer about unsaved edits. */
  protected readonly confirmingClose = signal(false);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>("dialog");

  constructor() {
    // A dialog nobody's focus is in cannot be dismissed from a keyboard, and
    // reads to a screen reader as the editor still being where you are.
    effect(() => {
      if (this.confirmingClose()) this.dialog()?.nativeElement.focus();
    });
  }

  protected readonly unchanged = () =>
    this.draftFront().trim() === this.front() && this.draftBack().trim() === this.back();

  protected readonly incomplete = () => !this.draftFront().trim() || !this.draftBack().trim();

  protected onSave(): void {
    if (this.incomplete()) return;
    this.save.emit({ front: this.draftFront().trim(), back: this.draftBack().trim() });
  }

  protected armDelete(): void {
    // One question at a time — two open panels leave it unclear which set of
    // buttons answers which.
    this.confirmingClose.set(false);
    this.confirmingDelete.set(true);
  }

  protected onDelete(): void {
    this.remove.emit();
  }

  /**
   * Closes, or asks first when there is something to lose.
   *
   * Public because the button that opened the editor also closes it, and the
   * question of whether that is safe belongs here — this is where the draft
   * lives. An untouched editor closes straight away: prompting then would be
   * asking about changes nobody made.
   */
  requestClose(): void {
    if (this.unchanged()) {
      this.dismissed.emit();
      return;
    }
    this.confirmingDelete.set(false);
    this.confirmingClose.set(true);
  }

  /** Puts the question away, leaving the editor open on the draft. */
  protected keepEditing(): void {
    this.confirmingClose.set(false);
  }

  /** Leaves the card as the note has it, losing what was typed. */
  protected discard(): void {
    this.confirmingClose.set(false);
    this.dismissed.emit();
  }

  protected onCancel(): void {
    this.confirmingDelete.set(false);
    this.requestClose();
  }
}
