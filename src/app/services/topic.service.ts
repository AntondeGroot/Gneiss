import { Injectable, computed, inject } from "@angular/core";

import { isInTopic, practiceQueue, selectDue, topicRows, weakestTopic } from "../../vault";
import { ClockService } from "./clock.service";
import { DeckService } from "./deck.service";
import type { DeckCard } from "./deck.service";
import type { Focus } from "./focus";

/**
 * The deck seen topic by topic, and the queue for whichever is chosen.
 *
 * A topic session goes through the same `selectDue` as the whole deck, with the
 * same portions, ordering and exams: it is an ordinary session drawn from fewer
 * cards, not a second kind of scheduling to keep in step with the first.
 */
@Injectable({ providedIn: "root" })
export class TopicService {
  private readonly deck = inject(DeckService);
  private readonly clock = inject(ClockService);

  readonly rows = computed(() =>
    topicRows(this.deck.all(), this.deck.topicTags(), this.clock.today()),
  );

  /** The topic most worth practising, or null when none stands out. */
  readonly weakest = computed(() => weakestTopic(this.rows()));

  /** The cards a session with this focus would serve, as of now. */
  queueFor(focus: Focus): readonly DeckCard[] {
    if (focus.kind === "deck") return this.deck.due();

    const cards = this.deck.all().filter((card) => isInTopic(card, focus.scope));
    const { newPerSession, reviewsPerSession, crams } = this.deck.config();
    const today = this.clock.today();

    if (focus.kind === "practice") {
      return practiceQueue(cards, today, newPerSession + reviewsPerSession);
    }
    return selectDue(cards, today, { newPerSession, reviewsPerSession, crams }).queue;
  }
}
