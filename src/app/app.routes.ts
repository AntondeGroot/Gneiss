import type { Routes } from "@angular/router";

import { VaultScreen } from "./vault-screen/vault-screen";

export const routes: Routes = [
  { path: "vault", component: VaultScreen },
  { path: "**", redirectTo: "vault" },
];
