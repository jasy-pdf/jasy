import { defineConfig, configDefaults } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Resolve relative to this config (the repo root), not process.cwd(), so a per-package run
// (`pnpm --filter @jasy/vue test`) finds the core source too, not just a root-level `pnpm test`.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Workspace packages (e.g. @jasy/zugferd, @jasy/vue) import the core as "@jasy/pdf"; resolve that to
  // the TS source so they run against live source without a build step.
  resolve: {
    alias: {
      "@jasy/pdf": resolve(rootDir, "src/lib/index.ts"),
      // @jasy/zugferd has no dist in a fresh CI test job (build runs in a separate job); alias it to
      // source too so the CLI suites resolve it without a build, same as @jasy/pdf above.
      "@jasy/zugferd": resolve(rootDir, "packages/zugferd/src/index.ts"),
    },
  },
  test: {
    // @jasy/nuxt is a Nuxt module with heavy @nuxt/test-utils e2e tests - run those via its own
    // `pnpm --filter @jasy/nuxt test`, not the root suite (which gates every package release).
    exclude: [...configDefaults.exclude, "packages/nuxt/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage", // Optional - How to save the protocols?
    },
  },
});
