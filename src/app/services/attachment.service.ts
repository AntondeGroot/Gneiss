import { Injectable } from "@angular/core";

import { splitCard } from "../../vault";
import type { DeckCard } from "./deck-card";
import type { VaultSource } from "./vault-source";

/**
 * The images cards carry, fetched and kept for the session.
 *
 * Split out of `DeckService`, which orchestrates the deck: what a card's
 * schedule is, and what bytes sit behind `![[diagram.png]]`, are unrelated jobs
 * that happened to share a service. Nothing about scheduling needs to know how
 * an image is loaded, and nothing here needs to know what a card is due.
 */
@Injectable({ providedIn: "root" })
export class AttachmentService {
  private source: VaultSource | null = null;
  private readonly loaded = new Map<string, string>();

  /** A new vault means new bytes behind the same names. */
  use(source: VaultSource): void {
    this.source = source;
    this.loaded.clear();
  }

  /**
   * An embedded image as something an `img` tag can load.
   *
   * Cached for the session: the same diagram often sits on several cards, and on
   * Android the bytes come back base64 across the bridge, which is the one part
   * of showing an image that is worth not repeating.
   */
  async load(target: string): Promise<string> {
    const known = this.loaded.get(target);
    if (known !== undefined) return known;

    const url = (await this.source?.readAttachment(target)) ?? "";
    // Only successes are kept. A miss can mean the vault has not finished
    // listing itself, and remembering that would make the card show a raw link
    // for as long as the app stays open.
    if (url !== "") this.loaded.set(target, url);

    return url;
  }

  /**
   * Fetches a card's images ahead of being asked for them.
   *
   * An image costs a round trip and a base64 decode, which is a visible pause if
   * it starts when the card appears. Warming the answer's images while the
   * question is still on screen — and the next card's while this one is being
   * answered — spends that time where nobody is waiting.
   */
  prefetch(...cards: readonly (DeckCard | undefined)[]): void {
    for (const card of cards) {
      if (!card) continue;
      for (const segment of splitCard(`${card.front}\n${card.back}`)) {
        if (segment.kind === "embed") void this.load(segment.target);
      }
    }
  }
}
