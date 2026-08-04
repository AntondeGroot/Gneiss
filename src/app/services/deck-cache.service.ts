import { Injectable } from "@angular/core";

import { formatConfig, parseConfig } from "../../vault";
import type { GneissConfig } from "../../vault";
import type { DeckCard } from "./deck.service";

const KEY = "gneiss.deck";
/**
 * Roughly four sessions' worth of the most urgent cards.
 *
 * Enough to review for days without the vault, small enough that rewriting it
 * after each grade is not itself a pause — the whole deck would be hundreds of
 * kilobytes of JSON on every card. The vault is deliberately not copied here:
 * the point is a head start while the real read catches up.
 */
const KEPT = 150;

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
      cards: [...cards].sort(byDueDate).slice(0, KEPT),
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

function isDeckCard(value: unknown): value is DeckCard {
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
