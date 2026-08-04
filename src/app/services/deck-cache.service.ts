import { Injectable } from "@angular/core";

import { formatConfig, parseConfig } from "../../vault";
import type { GneissConfig } from "../../vault";
import type { DeckCard } from "./deck.service";

const KEY = "gneiss.deck";
/**
 * How many sessions the cache should be able to serve.
 *
 * Enough to review for days without the vault, small enough that rewriting it
 * after each grade is not itself a pause — the whole deck would be hundreds of
 * kilobytes of JSON on every card.
 */
const SESSIONS = 4;

interface CachedDeck {
  /** Which vault this came from, so another vault's cards are never served. */
  readonly vault: string;
  /** Stored in the same markdown the vault uses, so there is no second format. */
  readonly config: string;
  readonly cards: readonly DeckCard[];
  /** Every topic tag, so Settings' tier table is right before the vault is read. */
  readonly topics: readonly string[];
}

/**
 * A slice of the deck kept on the device, so opening the app starts a session
 * immediately instead of waiting on the vault.
 *
 * The vault stays the source of truth — this is a head start, not a copy. A
 * fresh read replaces whatever is here, and grades are written straight to the
 * notes rather than being held here, so nothing is lost if the cache is dropped.
 */
@Injectable({ providedIn: "root" })
export class DeckCacheService {
  /** Keeps the most urgent cards — the ones a session would serve first anyway. */
  save(
    vault: string,
    config: GneissConfig,
    cards: readonly DeckCard[],
    topics: readonly string[],
  ): void {
    if (!vault) return;

    const deck: CachedDeck = {
      vault,
      config: formatConfig(config),
      cards: keepEnoughFor(cards, config),
      topics: [...topics],
    };
    write(JSON.stringify(deck));
  }

  /** The cached deck for `vault`, or null when there is none worth trusting. */
  load(vault: string): { config: GneissConfig; cards: DeckCard[]; topics: string[] } | null {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw || !vault) return null;

    try {
      return readDeck(JSON.parse(raw), vault);
    } catch {
      // A half-written or older cache is not worth recovering: the vault has the
      // truth, and this only costs the head start on one launch.
      return null;
    }
  }

  clear(): void {
    globalThis.localStorage?.removeItem(KEY);
  }
}

/**
 * Reads what was stored, checking rather than trusting it.
 *
 * Anything parsed back off a device is input, not data: a cache written by an
 * older build, or half-written when the app was killed, would otherwise reach
 * the scheduler as cards missing the fields it needs. One bad card drops the
 * whole cache, since a partly-loaded deck is harder to explain than a slow start.
 */
function readDeck(
  parsed: unknown,
  vault: string,
): { config: GneissConfig; cards: DeckCard[]; topics: string[] } | null {
  if (typeof parsed !== "object" || parsed === null) return null;

  const deck = parsed as Partial<Record<keyof CachedDeck, unknown>>;
  if (deck.vault !== vault || typeof deck.config !== "string") return null;
  if (!Array.isArray(deck.cards) || !deck.cards.every(isDeckCard)) return null;

  return {
    config: parseConfig(deck.config),
    cards: deck.cards,
    topics: Array.isArray(deck.topics) ? deck.topics.filter(isString) : [],
  };
}

/**
 * Whether this is a card the scheduler can act on.
 *
 * Shared with the saved session: both read back state written to the device,
 * which is input rather than data — a payload from an older build could
 * otherwise arrive missing the fields scheduling needs.
 */
export function isDeckCard(value: unknown): value is DeckCard {
  if (typeof value !== "object" || value === null) return false;

  const card = value as Partial<Record<keyof DeckCard, unknown>>;
  const review = card.review as Partial<DeckCard["review"]> | undefined;
  return (
    isString(card.id) &&
    isString(card.note) &&
    isString(card.front) &&
    isString(card.back) &&
    isString(card.tier) &&
    Array.isArray(card.topicTags) &&
    isString(review?.due) &&
    typeof review?.interval === "number" &&
    typeof review?.ease === "number"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * A few sessions' worth of each kind of card.
 *
 * The two pools are filled separately, exactly as `selectDue` serves them.
 * Taking the most urgent cards overall looked equivalent and was not: an
 * imported vault's reviews are years overdue while new cards are dated today, so
 * sorting by date put every review first and no new card was ever cached. A
 * session run from the cache had nothing new in it at all.
 */
function keepEnoughFor(cards: readonly DeckCard[], config: GneissConfig): DeckCard[] {
  const reviews = cards.filter(isSeen).sort(byDueDate);
  const fresh = cards.filter((card) => !isSeen(card)).sort(byDueDate);

  return [
    ...reviews.slice(0, config.reviewsPerSession * SESSIONS),
    ...fresh.slice(0, config.newPerSession * SESSIONS),
  ];
}

/** Seen before — the same test the queue uses to tell the pools apart. */
function isSeen(card: DeckCard): boolean {
  return card.review.interval > 0;
}

/** Most overdue first — the order a session would serve them in anyway. */
function byDueDate(a: DeckCard, b: DeckCard): number {
  return a.review.due.localeCompare(b.review.due);
}

function write(value: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    // Storage can be full or refused. A missing cache costs a slower launch and
    // nothing else, so it is not worth interrupting a review over.
  }
}
