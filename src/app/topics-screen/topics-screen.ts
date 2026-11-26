import { Component, computed, inject, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

import { isWithinScope } from "../../vault";
import type { TopicRow } from "../../vault";
import { DeckService } from "../services/deck.service";
import type { Focus } from "../services/focus";
import { ReviewSessionService } from "../services/review-session.service";
import { TopicService } from "../services/topic.service";

const SEPARATOR = "/";

/**
 * The deck topic by topic, for choosing what to work on by hand.
 *
 * Today is the app's plan; this is the user's. A row says what is due, new and
 * held in a topic, and choosing one offers an ordinary session narrowed to it —
 * or, for a topic known to be weak, practice ahead of its schedule.
 *
 * Collapsed to the top level at first, as the Obsidian SR plugin's deck list is:
 * a vault's topics run deep, and the whole tree at once is a wall of rows.
 */
@Component({
  selector: "gn-topics-screen",
  imports: [RouterLink],
  templateUrl: "./topics-screen.html",
  styleUrl: "./topics-screen.scss",
})
export class TopicsScreen {
  private readonly deck = inject(DeckService);
  private readonly topics = inject(TopicService);
  private readonly session = inject(ReviewSessionService);
  private readonly router = inject(Router);

  protected readonly rows = this.topics.rows;
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly selected = signal<string | null>(null);

  /** Rows whose every parent is open. */
  protected readonly visible = computed(() =>
    this.rows().filter((row) => parentsOf(row.tag).every((tag) => this.expanded().has(tag))),
  );

  protected readonly reviewSize = computed(() => this.sizeFor("topic"));
  protected readonly practiceSize = computed(() => this.sizeFor("practice"));

  constructor() {
    // Arriving from Today's "weakest topic" line opens straight onto that topic.
    const topic = inject(ActivatedRoute).snapshot.queryParamMap.get("topic");
    if (topic) this.reveal(topic);
  }

  protected isExpanded(row: TopicRow): boolean {
    return this.expanded().has(key(row.tag));
  }

  protected isSelected(row: TopicRow): boolean {
    return this.selected() === row.tag;
  }

  protected toggle(row: TopicRow): void {
    const next = new Set(this.expanded());
    if (!next.delete(key(row.tag))) next.add(key(row.tag));
    this.expanded.set(next);
  }

  protected select(row: TopicRow): void {
    this.selected.set(this.isSelected(row) ? null : row.tag);
  }

  /** Days to the soonest exam covering this topic, or null when none does. */
  protected examDays(row: TopicRow): number | null {
    return this.deck.crams().find((plan) => isWithinScope(row.tag, plan.scope))?.daysLeft ?? null;
  }

  protected review(row: TopicRow): void {
    this.begin({ kind: "topic", scope: row.tag });
  }

  protected practise(row: TopicRow): void {
    this.begin({ kind: "practice", scope: row.tag });
  }

  private begin(focus: Focus): void {
    this.session.start(focus);
    void this.router.navigate(["/review"]);
  }

  private sizeFor(kind: "topic" | "practice"): number {
    const scope = this.selected();
    return scope === null ? 0 : this.topics.queueFor({ kind, scope }).length;
  }

  /** Selects a topic and opens every level above it, so it is on screen. */
  private reveal(tag: string): void {
    this.selected.set(tag);
    this.expanded.set(new Set([...this.expanded(), ...parentsOf(tag)]));
  }
}

/** Matched without case, as tags are everywhere else. */
function key(tag: string): string {
  return tag.toLowerCase();
}

/**
 * Each level above a topic, as keys — not counting the bare `#flashcards`,
 * which has no row of its own.
 */
function parentsOf(tag: string): string[] {
  const segments = key(tag).split(SEPARATOR);
  return segments.slice(2).map((_, index) => segments.slice(0, index + 2).join(SEPARATOR));
}
