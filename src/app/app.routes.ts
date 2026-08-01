import type { Routes } from "@angular/router";

import { ReviewScreen } from "./review-screen/review-screen";
import { SettingsScreen } from "./settings-screen/settings-screen";
import { TodayScreen } from "./today-screen/today-screen";
import { VaultScreen } from "./vault-screen/vault-screen";

export const routes: Routes = [
  { path: "today", component: TodayScreen },
  { path: "vault", component: VaultScreen },
  // Review hides the tab bar: nothing should compete with the card being recalled.
  { path: "review", component: ReviewScreen, data: { hideTabBar: true } },
  { path: "settings", component: SettingsScreen },
  { path: "**", redirectTo: "today" },
];
