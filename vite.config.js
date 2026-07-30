import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The clickable prototype and its Vite entry point live under prototype/;
// index.html (repo root) mounts prototype/src/main.jsx.
export default defineConfig({
  plugins: [react()],
});