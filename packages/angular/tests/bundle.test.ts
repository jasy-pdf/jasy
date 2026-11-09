// The package index is imported eagerly (provideJasy() in app.config.ts), and Angular's build keeps
// every module it re-exports. One static import of the engine anywhere in src/ would put all of it into
// an app's start bundle, and @defer around the PDF feature would no longer help: 231 KB became 514 KB.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url);

describe("the engine stays out of the start bundle", () => {
  it.each(readdirSync(SRC).filter((f) => f.endsWith(".ts")))(
    "%s imports @jasy/pdf only as types or lazily",
    (file) => {
      const source = readFileSync(new URL(file, SRC), "utf-8");
      // `import x from`, `export x from` and a bare `import "..."` all load the module; `import type` does not.
      const statics = [
        ...source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"(@jasy\/pdf[^"]*)"/gms),
        ...source.matchAll(/^import\s+"(@jasy\/pdf[^"]*)"/gm),
      ].map((m) => m[1]);
      expect(statics).toEqual([]);
    },
  );
});
