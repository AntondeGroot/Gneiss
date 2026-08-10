import { Component, computed, inject } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { isWithinScope } from "../../vault";
import type { Tier } from "../../vault";
import { DeckService } from "../services/deck.service";
import { ReviewSessionService } from "../services/review-session.service";
import type { DeckCard } from "../services/deck.service";

/** Ring geometry. The radius drives the circumference every segment is cut from. */
const RADIUS = 56;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const TIER_ORDER: readonly Tier[] = ["core", "standard", "optional"];

/** Inside the tier ring, with room to read as a separate arc. */
const INNER_RADIUS = 44;
const INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_RADIUS;

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
  private readonly session = inject(ReviewSessionService);
  private readonly router = inject(Router);

  protected readonly radius = RADIUS;
  protected readonly innerRadius = INNER_RADIUS;
  protected readonly circumference = CIRCUMFERENCE;
  /** One hatch pattern per tier, defined once in the ring's `<defs>`. */
  protected readonly tiers = TIER_ORDER;

  protected readonly due = this.deck.due;
  protected readonly streak = this.deck.streak;
  protected readonly streakEarned = this.deck.streakEarnedToday;
  protected readonly heldBackNew = this.deck.heldBackNew;
  protected readonly heldBackReviews = this.deck.heldBackReviews;
  protected readonly heldCrammed = this.deck.heldCrammed;

  /**
   * While an exam runs the deadline leads, not the tier ring — see CLAUDE.md.
   *
   * One countdown per exam, soonest first, so an exam week reads as the week it
   * is rather than as whichever exam happens to be nearest.
   */
  protected readonly crams = this.deck.crams;

  /** The tag's last segment: `#flashcards/lang/certexam` reads as `certexam`. */
  protected topicOf(scope: string): string {
    return lastSegment(scope);
  }

  protected percentOf(progress: number): number {
    return Math.round(progress * 100);
  }

  /** Due cards for one exam, so each countdown carries its own figure. */
  protected dueFor(scope: string): number {
    return this.deck.due().filter((card) => card.topicTags.some((tag) => isWithinScope(tag, scope)))
      .length;
  }
  protected readonly loaded = computed(() => this.deck.all().length > 0);

  protected readonly segments = computed(() => toSegments(this.due()));

  /** A session left part-way through, which this screen offers to continue. */
  protected readonly unfinished = this.session.unfinished;
  protected readonly left = this.session.remaining;

  /**
   * The inner arc: how much of the open session is done.
   *
   * Drawn inside the tier ring rather than replacing it, so the two questions
   * stay separate — the outer ring is what the day holds, the inner one is how
   * far into it you are.
   */
  protected readonly sessionArc = computed(() => {
    const total = this.session.total();
    if (total === 0) return "0 " + String(INNER_CIRCUMFERENCE);

    const done = (this.session.progress() / 100) * INNER_CIRCUMFERENCE;
    return `${done} ${INNER_CIRCUMFERENCE - done}`;
  });

  protected start(): void {
    // Picks up an open session, or begins one. The Review screen does not start
    // over on arrival, so "continue" means what it says.
    this.session.resume();
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
