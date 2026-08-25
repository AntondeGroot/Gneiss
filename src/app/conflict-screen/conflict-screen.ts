import { Component, computed, effect, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";

import { conflictedCopyOf, stripReviewComments } from "../../vault";
import type { ConflictHunk, Resolution } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { VaultConflict } from "../services/deck-card";

/** One difference, with the wording that fits the shape it has. */
export interface Question {
  readonly hunk: ConflictHunk;
  /** Text as each side has it, with review comments taken out — they are noise. */
  readonly mine: string;
  readonly theirs: string;
  /** True when the card exists on one side only, which reads as add-or-drop. */
  readonly oneSided: boolean;
}

/**
 * Settling one conflicted note, on a screen of its own.
 *
 * A page rather than a panel in the Vault list, and it takes the whole screen
 * the way reviewing does. Two versions of a card have to be read side by side to
 * be chosen between, and the way out is by finishing or cancelling — there is no
 * half-settled state worth wandering away from.
 *
 * Which note is in the query string rather than in a service, so the screen
 * survives being reloaded, and only the *copy* is named: the note it duplicates
 * is whatever `conflictedCopyOf` says, which keeps the address from disagreeing
 * with the rule the rest of the app uses.
 *
 * The screen only ever asks about text. Schedules are merged underneath — each
 * direction of each card keeping whichever side reviewed it more recently — and
 * deliberately not shown as decisions to confirm: there is a right answer, and
 * offering it as a choice invites someone to compare two dates they cannot
 * remember and get it wrong.
 */
@Component({
  selector: "gn-conflict-screen",
  templateUrl: "./conflict-screen.html",
  styleUrl: "./conflict-screen.scss",
})
export class ConflictScreen {
  private readonly deck = inject(DeckService);
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParams, { initialValue: {} });

  protected readonly conflict = computed<VaultConflict | null>(() => {
    const copy = (this.params() as Record<string, string>)["copy"] ?? "";
    const note = conflictedCopyOf(copy);

    return note === null ? null : { note, copy };
  });

  protected readonly questions = signal<readonly Question[]>([]);
  protected readonly choices = signal<readonly Resolution[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      const conflict = this.conflict();
      if (!conflict) {
        void this.leave();
        return;
      }

      this.loading.set(true);
      void this.deck.openConflict(conflict).then((hunks) => {
        this.questions.set(hunks.map(toQuestion));
        this.choices.set(hunks.map(() => "both" as const));
        this.loading.set(false);
      });
    });
  }

  protected choose(at: number, resolution: Resolution): void {
    this.choices.update((choices) =>
      choices.map((was, index) => (index === at ? resolution : was)),
    );
  }

  protected chosen(at: number): Resolution {
    return this.choices()[at] ?? "both";
  }

  /**
   * A note with nothing to ask about still needs settling: its schedules were
   * merged and its copy is still on disk, so the button stays the same one.
   */
  protected async apply(): Promise<void> {
    const conflict = this.conflict();
    if (!conflict) return;

    this.saving.set(true);
    try {
      await this.deck.resolveConflict(conflict, this.choices());
      await this.leave();
    } finally {
      this.saving.set(false);
    }
  }

  protected leave(): Promise<boolean> {
    return this.router.navigate(["/vault"]);
  }
}

function toQuestion(hunk: ConflictHunk): Question {
  return {
    hunk,
    mine: display(hunk.mine),
    theirs: display(hunk.theirs),
    oneSided: hunk.mine === undefined || hunk.theirs === undefined,
  };
}

/** What to put on screen: the card, without the review state nobody reads. */
function display(text: string | undefined): string {
  return stripReviewComments(text ?? "").trim();
}
