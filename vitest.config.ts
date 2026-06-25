import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Resolve relative to this config (the repo root), not process.cwd(), so a per-package run
// (`pnpm --filter @jasy/vue test`) finds the core source too, not just a root-level `pnpm test`.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Workspace packages (e.g. @jasy/zugferd, @jasy/vue) import the core as "@jasy/pdf"; resolve that to
  // the TS source so they run against live source without a build step.
  resolve: {
    alias: { "@jasy/pdf": resolve(rootDir, "src/lib/index.ts") },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage", // Optional - How to save the protocols?
    },
  },
});
