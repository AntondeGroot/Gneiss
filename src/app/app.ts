import { Component, DestroyRef, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterOutlet } from "@angular/router";
import { filter, map } from "rxjs";

import { TabBar } from "./tab-bar/tab-bar";

/**
 * How long the splash holds before fading. Long enough to read the wordmark,
 * short enough not to be in the way of a daily-use app.
 */
const SPLASH_MS = 1300;

@Component({
  selector: "gn-root",
  imports: [RouterOutlet, TabBar],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {
  private readonly router = inject(Router);

  protected readonly booting = signal(true);

  /** Review hides the bar so nothing competes with the card being recalled. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: "" },
  );
  protected readonly showTabBar = computed(() => !this.url().startsWith("/review"));

  constructor() {
    const timer = setTimeout(() => this.booting.set(false), SPLASH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
    });
  }
}
