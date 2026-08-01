import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS bundle identifier. Cheap to change now; painful once native
  // projects are generated and signing certificates are tied to it.
  appId: "com.gneiss.app",
  appName: "Gneiss",

  // Angular's production output. `npx cap sync` copies this into the native
  // projects, so it must be built before syncing.
  webDir: "dist/gneiss/browser",
};

export default config;
