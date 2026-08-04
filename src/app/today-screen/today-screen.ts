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
  /** Never reviewed before. Drawn hatched, so tier stays the colour axis. */
  readonly fresh: boolean;
  readonly count: number;
  /** `stroke-dasharray` and `stroke-dashoffset` placing this arc on the ring. */
  readonly dash: string;
  readonly offset: number;
  /** Class carrying the paint: a tier colour, or that colour hatched. */
  readonly paint: string;
  readonly label: string;
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
  /** One hatch pattern per tier, defined once in the ring's `<defs>`. */
  protected readonly tiers = TIER_ORDER;

  protected readonly due = this.deck.due;
  protected readonly streak = this.deck.streak;
  protected readonly heldBackNew = this.deck.heldBackNew;
  protected readonly heldBackReviews = this.deck.heldBackReviews;
  protected readonly heldCrammed = this.deck.heldCrammed;

  /** While a cram runs the deadline leads, not the tier ring — see CLAUDE.md. */
  protected readonly cram = this.deck.cram;
  protected readonly cramDue = computed(() => this.deck.cramDue().length);
  /** The tag's last segment: `#flashcards/lang/certexam` reads as `certexam`. */
  protected readonly cramTopic = computed(() => lastSegment(this.deck.cramScope()));
  protected readonly cramPercent = computed(() => Math.round((this.cram()?.progress ?? 0) * 100));
  protected readonly loaded = computed(() => this.deck.all().length > 0);

  protected readonly segments = computed(() => toSegments(this.due()));

  protected start(): void {
    void this.router.navigate(["/review"]);
  }
}

function lastSegment(tag: string): string {
  return tag.split("/").pop()?.replace("#", "") ?? "";
}

/**
 * One arc per tier and state, sized by share of the due queue and laid end to
 * end.
 *
 * Two things are said at once, so they use two channels: colour carries the
 * tier, hatching carries whether the card is new. Giving new cards their own
 * colours would need six hues and make the tier — the thing the whole app is
 * about — harder to read, not easier.
 *
 * Reviews come before new within a tier, the order a session serves them in.
 * Segments are emitted in a fixed order so the ring does not reorder itself as
 * counts change.
 */
function toSegments(due: readonly DeckCard[]): RingSegment[] {
  const total = due.length;
  if (total === 0) return [];

  let consumed = 0;
  const segments: RingSegment[] = [];

  for (const tier of TIER_ORDER) {
    for (const fresh of [false, true]) {
      const count = due.filter((card) => card.tier === tier && isFresh(card) === fresh).length;
      if (count === 0) continue;

      const length = (count / total) * CIRCUMFERENCE;
      segments.push({
        tier,
        fresh,
        count,
        dash: `${length} ${CIRCUMFERENCE - length}`,
        offset: -consumed,
        paint: fresh ? `segment-${tier}-new` : `segment-${tier}`,
        label: fresh ? `new ${tier}` : tier,
      });
      consumed += length;
    }
  }
  return segments;
}

/** Never reviewed: the same test the queue uses to count new cards. */
function isFresh(card: DeckCard): boolean {
  return card.review.interval === 0;
}
