import { Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

import { DeckService } from "../services/deck.service";

/**
 * Today, Topics, Vault and Settings. Today is the app's plan for the day and
 * Topics is the user's own pick, so the two sit side by side.
 */
@Component({
  selector: "gn-tab-bar",
  imports: [RouterLink, RouterLinkActive],
  templateUrl: "./tab-bar.html",
  styleUrl: "./tab-bar.scss",
})
export class TabBar {
  private readonly deck = inject(DeckService);

  protected readonly due = this.deck.due;
  /**
   * A conflicted copy changes what gets reviewed without anything looking wrong,
   * so the bar carries it: the Vault tab is not somewhere anyone thinks to look
   * unless something sends them there.
   */
  protected readonly conflicts = this.deck.conflicts;
}
