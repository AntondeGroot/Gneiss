import { DestroyRef, Injectable, inject } from "@angular/core";

import { AndroidVaultSource } from "./android-vault.source";
import { DeckService } from "./deck.service";

/**
 * Long enough that flicking to another app and straight back costs nothing,
 * short enough that editing a note and switching over finds it. Seconds rather
 * than minutes, because a re-read is invisible — see the class comment.
 */
const AFTER_RETURNING_MS = 30_000;

/**
 * And again while the app simply stays open, since a vault also changes from the
 * other side: a note written on the laptop arrives by sync, with nothing on this
 * device to say so.
 */
const WHILE_OPEN_MS = 15 * 60_000;

/**
 * Keeps the deck in step with the folder on disk.
 *
 * The vault used to be read exactly once, in the root component's constructor.
 * On a phone that runs on a cold start and almost never again — the app is
 * resumed from the background for days — so a note added in Obsidian never
 * joined the deck, and nothing on screen suggested the app was showing a stale
 * copy of the folder.
 *
 * Two moments to look again, and neither can be dropped:
 *
 * - **Coming back to the app**, which is the same trigger `ClockService` uses
 *   for the date and for the same reason — a sleeping phone runs no timers, so
 *   a schedule alone would not fire.
 * - **While the app stays open**, because the folder changes from the other end
 *   too, and a device left on the Today screen would never notice.
 *
 * Re-reading costs nothing on screen. With cards already showing, `readVault`
 * streams into a staging list and swaps it in once at the end, so nothing grows
 * or reorders under the reader — and a grade given mid-read is re-applied
 * afterwards. The delays below are only there to avoid pointless work, not to
 * protect the UI from a read it cannot see.
 */
@Injectable({ providedIn: "root" })
export class VaultRefreshService {
  private readonly deck = inject(DeckService);
  private readonly vault = inject(AndroidVaultSource);

  /**
   * When the vault was last looked at — stamped when a read *starts* as well as
   * when it ends, so a trigger arriving mid-read does not ask for a second one.
   * A failed read counts too, so a vault that cannot be opened is not hammered.
   */
  private lastReadAt = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    this.read(true);
    document.addEventListener("visibilitychange", this.onReturn);
    this.timer = setInterval(this.onTick, WHILE_OPEN_MS);
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Reads now, whatever the delays say — what the Vault screen's button asks for. */
  refreshNow(): void {
    this.read(false);
  }

  private readonly onReturn = (): void => {
    if (document.visibilityState !== "visible") return;
    this.readIfOlderThan(AFTER_RETURNING_MS);
  };

  private readonly onTick = (): void => {
    if (document.visibilityState !== "visible") return;
    this.readIfOlderThan(WHILE_OPEN_MS);
  };

  private readIfOlderThan(age: number): void {
    if (Date.now() - this.lastReadAt < age) return;
    this.read(false);
  }

  /**
   * Opens the remembered vault. Only the first read serves the cache first: it
   * is a head start for a deck that has nothing in it, and re-seeding it later
   * would put a stale slice back over cards read since.
   */
  private read(first: boolean): void {
    const remembered = this.vault.remembered();
    if (!remembered) return;

    if (first) this.deck.restore(this.vault.rememberedName());
    this.lastReadAt = Date.now();
    void this.deck
      .open(this.vault, remembered)
      .catch(() => {
        // A vault that cannot be reopened — grant withdrawn, folder moved —
        // leaves the cards already loaded in place and says so on the Vault
        // screen, which is where picking a folder again belongs.
      })
      .finally(() => {
        this.lastReadAt = Date.now();
      });
  }

  private stop(): void {
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onReturn);
  }
}
