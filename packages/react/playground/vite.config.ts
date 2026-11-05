import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// 100% browser: the @jasy/pdf engine renders the PDF client-side, no server.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // @jasy/react straight from its source, so the playground needs no build step. @jasy/pdf is NOT
    // aliased: it resolves via its package so its `browser` field swaps the platform ports in.
    alias: [
      {
        find: /^@jasy\/react$/,
        replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      },
    ],
  },
});
