import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The clickable prototype and its Vite entry point live under prototype/;
// index.html (repo root) mounts prototype/src/main.jsx.
// src/vault/ is the framework-free module the prototype consumes and the real app will lift.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // types.ts is type-only (no runtime code); index.ts is a re-export barrel.
      exclude: ["src/**/*.test.ts", "src/vault/types.ts", "src/vault/index.ts"],
      reporter: ["text-summary", "lcov"],
      // Ratchet: a frozen floor pinned at the current numbers, so coverage can
      // only rise. Lines, functions and statements are past the checklist's 90.
      //
      // Branches sit below 90 and the remainder is deliberate: what's left is
      // defensive code that is unreachable by construction or guards a case the
      // types already exclude — `lastNonBlankLine` returning null (withTier
      // early-returns unless the note has a tag), the NaN date guard, and the
      // `?? ""` fallbacks behind a regex that has already matched. Contriving
      // tests for those would buy a number, not confidence.
      thresholds: {
        lines: 99,
        branches: 83,
        functions: 100,
        statements: 95,
      },
    },
  },
});
