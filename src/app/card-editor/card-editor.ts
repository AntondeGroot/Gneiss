import { Component, input, linkedSignal, output, signal } from "@angular/core";
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
})
export class CardEditor {
  readonly front = input.required<string>();
  readonly back = input.required<string>();
  /** Where the note sits in the vault, and the link that opens it in Obsidian. */
  readonly folder = input("");
  readonly noteUri = input("");
  readonly notePath = input("");

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

  protected readonly unchanged = () =>
    this.draftFront().trim() === this.front() && this.draftBack().trim() === this.back();

  protected readonly incomplete = () => !this.draftFront().trim() || !this.draftBack().trim();

  protected onSave(): void {
    if (this.incomplete()) return;
    this.save.emit({ front: this.draftFront().trim(), back: this.draftBack().trim() });
  }

  protected armDelete(): void {
    this.confirmingDelete.set(true);
  }

  protected onDelete(): void {
    this.remove.emit();
  }

  protected onCancel(): void {
    this.confirmingDelete.set(false);
    this.dismissed.emit();
  }
}
