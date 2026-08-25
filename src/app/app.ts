import { Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet } from "@angular/router";
import { filter, map } from "rxjs";

import { AndroidVaultSource } from "./services/android-vault.source";
import { DeckService } from "./services/deck.service";
import { TabBar } from "./tab-bar/tab-bar";

/**
 * Screens that take the whole screen: reviewing, where nothing should compete
 * with the card, and settling a conflict, which is a job with a way in and two
 * ways out.
 */
const HIDDEN_ON = ["/review", "/conflict"];

@Component({
  selector: "gn-root",
  imports: [RouterOutlet, TabBar],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {
  private readonly router = inject(Router);
  private readonly deck = inject(DeckService);
  private readonly androidVault = inject(AndroidVaultSource);

  /** Review hides the bar so nothing competes with the card being recalled. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: "" },
  );
  protected readonly showTabBar = computed(
    () => !HIDDEN_ON.some((route) => this.url().startsWith(route)),
  );

  constructor() {
    this.openLastVault();
  }

  /**
   * Serves the cached deck at once, then refreshes it from the vault behind the
   * splash.
   *
   * Done here rather than on the Vault screen because the app can open on any
   * tab, and the whole point is that Today already has a session ready. The
   * cache is a head start: the read that follows replaces it.
   */
  private openLastVault(): void {
    const remembered = this.androidVault.remembered();
    if (!remembered) return;

    this.deck.restore(this.androidVault.rememberedName());
    void this.deck.open(this.androidVault, remembered).catch(() => {
      // A vault that cannot be reopened — grant withdrawn, folder moved — leaves
      // the cached cards in place and says so on the Vault screen, which is
      // where picking a folder again belongs.
    });
  }
}
