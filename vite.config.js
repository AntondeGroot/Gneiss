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
      // can only rise, and CI stays green while the suite is still being written.
      // TODO: climb to the checklist target of 90 across the board as tests 3-16 land.
      thresholds: {
        lines: 22,
        branches: 22,
        functions: 21,
        statements: 22,
      },
    },
  },
});