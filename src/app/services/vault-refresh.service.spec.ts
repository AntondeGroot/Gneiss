import { TestBed } from "@angular/core/testing";

import { AndroidVaultSource } from "./android-vault.source";
import { DeckService } from "./deck.service";
import { VaultRefreshService } from "./vault-refresh.service";

/** Records what it was asked to open, so a re-read is visible to the test. */
function fakeDeck() {
  const opened: string[] = [];
  return {
    opened,
    restore: () => false,
    open: (_source: unknown, location: string) => {
      opened.push(location);
      return Promise.resolve();
    },
  };
}

const REMEMBERED = "content://vault";

function fakeVault() {
  return { remembered: () => REMEMBERED, rememberedName: () => "MyVault" };
}

function visible(state: DocumentVisibilityState): void {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("VaultRefreshService", () => {
  let deck: ReturnType<typeof fakeDeck>;

  beforeEach(() => {
    vi.useFakeTimers();
    deck = fakeDeck();
    TestBed.configureTestingModule({
      providers: [
        { provide: DeckService, useValue: deck },
        { provide: AndroidVaultSource, useValue: fakeVault() },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * The bug this exists for: the vault was read once, in the root component's
   * constructor, and never again. On a phone that constructor runs on a cold
   * start and almost never after — the app is resumed from the background for
   * days — so a note added in Obsidian never appeared in the deck, with nothing
   * on screen to suggest the app was showing a stale copy of the folder.
   *
   * Coming back to the app is the moment to look again. It is the same reasoning
   * `ClockService` uses for the date, and for the same reason: a sleeping phone
   * runs no timers, so a schedule alone would not fire either.
   */
  it("reads the vault again when the app is returned to after a while", async () => {
    TestBed.inject(VaultRefreshService);
    await Promise.resolve();
    expect(deck.opened).toHaveLength(1);

    vi.advanceTimersByTime(10 * 60 * 1000);
    visible("visible");
    await Promise.resolve();

    expect(deck.opened).toEqual([REMEMBERED, REMEMBERED]);
  });

  /**
   * The other half of the rule. Flicking to another app to check something and
   * coming straight back is not a reason to walk every file in the vault again —
   * the read is invisible, but it is not free.
   *
   * The delay is in seconds rather than minutes precisely because it is only
   * guarding against that: with nothing on screen disturbed by a re-read, there
   * is no reason to wait longer than it takes to rule out a stray switch.
   */
  it("does not read again when the app is returned to a moment later", async () => {
    TestBed.inject(VaultRefreshService);
    await Promise.resolve();

    vi.advanceTimersByTime(2000);
    visible("hidden");
    visible("visible");
    await Promise.resolve();

    expect(deck.opened).toHaveLength(1);
  });

  /**
   * A vault changes from the other end too: a note written on the laptop arrives
   * by sync with nothing on this device to announce it. An app left open on the
   * Today screen would never look again, so the clock is the second trigger.
   */
  it("reads again while the app simply stays open", async () => {
    TestBed.inject(VaultRefreshService);
    await Promise.resolve();

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000);

    expect(deck.opened.length).toBeGreaterThan(1);
  });
});
