import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Lets the client import ../server/src/constants.js (shared movement code).
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      // index.html = 3D game, 2d.html = original top-down version (kept as a fallback).
      input: { main: resolve(import.meta.dirname, "index.html"), twoD: resolve(import.meta.dirname, "2d.html") },
    },
  },
});
