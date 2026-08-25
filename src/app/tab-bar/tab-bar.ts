import { Component, inject } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";

import { DeckService } from "../services/deck.service";

/**
 * Two slots only, both part of the daily loop. Settings is deliberately not a tab:
 * it is config touched monthly, and the bar's slots are reserved for what is used
 * every day.
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
