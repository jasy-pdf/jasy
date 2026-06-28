import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

// 100% browser: the @jasy/pdf engine renders the PDF client-side (no server, no dev middleware).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Resolve @jasy/vue straight from its source, so the playground runs with no build step and survives
    // node_modules drift (the self-ref symlink going missing). @jasy/pdf is deliberately NOT aliased - it
    // keeps resolving via its package so its `browser` field still swaps the platform ports for the browser.
    // Dev-only: this file is not part of the published package, so it can never affect the build/release.
    alias: [
      { find: /^@jasy\/vue$/, replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    ],
  },
  // vue-pdf-embed bundles pdf.js + its worker; excluding it from pre-bundling keeps that worker happy.
  optimizeDeps: { exclude: ["vue-pdf-embed"] },
});
