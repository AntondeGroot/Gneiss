import { Component, computed, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import type { Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { DeckCard } from "../services/deck.service";

/** Ring geometry. The radius drives the circumference every segment is cut from. */
const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TIER_ORDER: readonly Tier[] = ["core", "standard", "optional"];

export interface RingSegment {
  readonly tier: Tier;
  readonly count: number;
  /** `stroke-dasharray` and `stroke-dashoffset` placing this arc on the ring. */
  readonly dash: string;
  readonly offset: number;
}

@Component({
  selector: "gn-today-screen",
  imports: [RouterLink],
  templateUrl: "./today-screen.html",
  styleUrl: "./today-screen.scss",
})
export class TodayScreen {
  private readonly deck = inject(DeckService);
  private readonly router = inject(Router);

  protected readonly radius = RADIUS;
  protected readonly circumference = CIRCUMFERENCE;

  protected readonly due = this.deck.due;
  protected readonly streak = this.deck.streak;
  protected readonly heldBack = this.deck.heldBack;
  protected readonly loaded = computed(() => this.deck.all().length > 0);

  protected readonly segments = computed(() => toSegments(this.due()));

  protected start(): void {
    void this.router.navigate(["/review"]);
  }
}

/**
 * One arc per tier, sized by share of the due queue and laid end to end.
 * Segments are emitted in a fixed tier order so the ring does not reorder itself
 * as counts change.
 */
function toSegments(due: readonly DeckCard[]): RingSegment[] {
  const total = due.length;
  if (total === 0) return [];

  let consumed = 0;
  const segments: RingSegment[] = [];

  for (const tier of TIER_ORDER) {
    const count = due.filter((card) => card.tier === tier).length;
    if (count === 0) continue;

    const length = (count / total) * CIRCUMFERENCE;
    segments.push({
      tier,
      count,
      dash: `${length} ${CIRCUMFERENCE - length}`,
      offset: -consumed,
    });
    consumed += length;
  }
  return segments;
}
