import type { Routes } from "@angular/router";

import { ReviewScreen } from "./review-screen/review-screen";
import { VaultScreen } from "./vault-screen/vault-screen";

export const routes: Routes = [
  { path: "vault", component: VaultScreen },
  { path: "review", component: ReviewScreen },
  { path: "**", redirectTo: "vault" },
];
