import { defineConfig } from "vite";

export default defineConfig({
  // Lets the client import ../server/src/constants.js (shared movement code).
  server: { fs: { allow: [".."] } },
});
