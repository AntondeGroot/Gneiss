import { Component, computed, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet } from "@angular/router";
import { filter, map } from "rxjs";

import { VaultRefreshService } from "./services/vault-refresh.service";
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
    // Injecting it is what starts it: the service reads the remembered vault
    // now, and keeps re-reading it as the app is used.
    inject(VaultRefreshService);
  }
}
