import { Component, DestroyRef, inject, signal } from "@angular/core";
import { RouterOutlet } from "@angular/router";

/**
 * How long the splash holds before fading. Long enough to read the wordmark,
 * short enough not to be in the way of a daily-use app.
 */
const SPLASH_MS = 1300;

@Component({
  selector: "gn-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
  styleUrl: "./app.scss",
})
export class App {
  protected readonly booting = signal(true);

  constructor() {
    const timer = setTimeout(() => this.booting.set(false), SPLASH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
    });
  }
}
