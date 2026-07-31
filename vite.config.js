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
  },
});