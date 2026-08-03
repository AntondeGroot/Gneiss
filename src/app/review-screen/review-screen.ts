import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";

import type { Grade } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { DeckCard } from "../services/deck.service";

const GRADES: readonly Grade[] = ["difficult", "medium", "easy"];

@Component({
  selector: "gn-review-screen",
  imports: [RouterLink],
  templateUrl: "./review-screen.html",
  styleUrl: "./review-screen.scss",
})
export class ReviewScreen {
  private readonly deck = inject(DeckService);

  /** Frozen when the session starts, so grading a card does not reshuffle it. */
  private readonly queue = signal<readonly DeckCard[]>([]);
  private readonly position = signal(0);

  protected readonly grades = GRADES;
  protected readonly revealed = signal(false);
  protected readonly started = signal(false);
  protected readonly graded = signal(0);
  /**
   * Sessions taken and cards graded across all of them, so a second helping is
   * reported as extra practice rather than restarting the count at zero.
   */
  protected readonly sessions = signal(0);
  protected readonly gradedAcrossSessions = signal(0);

  protected readonly dueCount = computed(() => this.deck.due().length);
  protected readonly writeError = this.deck.writeError;
  protected readonly current = computed(() => this.queue()[this.position()] ?? null);
  protected readonly remaining = computed(() => this.queue().length - this.position());
  protected readonly finished = computed(() => this.started() && this.current() === null);

  /**
   * Begins a session on whatever is due now. Also how a *second* session starts:
   * the cards graded a moment ago are no longer due, so re-reading the queue
   * picks up what today's pace held back.
   *
   * The pace is a target, not a wall. Nothing here stops someone reviewing the
   * whole backlog in one sitting if that is what they want.
   */
  protected start(): void {
    this.queue.set([...this.deck.due()]);
    this.position.set(0);
    this.graded.set(0);
    this.revealed.set(false);
    this.started.set(true);
    this.sessions.update((count) => count + 1);
  }

  protected reveal(): void {
    this.revealed.set(true);
  }

  /** When this grade would bring the card back, computed live from the settings. */
  protected preview(grade: Grade): string {
    const card = this.current();
    return card ? describeInterval(this.deck.preview(card, grade).interval) : "";
  }

  protected grade(grade: Grade): void {
    const card = this.current();
    if (!card) return;

    void this.deck.grade(card, grade);
    this.graded.update((count) => count + 1);
    this.gradedAcrossSessions.update((count) => count + 1);
    this.position.update((index) => index + 1);
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
