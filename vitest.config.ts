import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  // Workspace packages (e.g. @jasy-pdf/zugferd) import the core as "jasy-pdf"; resolve that to
  // the TS source so they run against live source without a build step.
  resolve: {
    alias: { "jasy-pdf": resolve(process.cwd(), "src/lib/index.ts") },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage", // Optional - How to save the protocols?
    },
  },
});
