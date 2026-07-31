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
      // Ratchet: a frozen floor pinned just under the current numbers, so coverage
      // can only rise. Lines, functions and statements are past the checklist's
      // target of 90.
      // TODO: climb branches to 90 — the shortfall is the unexercised edges
      // (frontmatter tiers, multi-entry SR comments, inline cards carrying review
      // state, and notes matching no mapping row).
      thresholds: {
        lines: 96,
        branches: 76,
        functions: 94,
        statements: 92,
      },
    },
  },
});