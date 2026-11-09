// The overloads and FormValues are promises about TYPES, which no runtime test can see: tests/types/api.ts
// writes the calls a user writes (and, after @ts-expect-error, the ones that must not compile).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("compiles the calls a user writes, and rejects the wrong ones", () => {
  const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
  const project = fileURLToPath(new URL("./types/tsconfig.json", import.meta.url));
  let output = "";
  try {
    execFileSync(tsc, ["-p", project], { encoding: "utf8" });
  } catch (e) {
    output = (e as { stdout?: string }).stdout ?? String(e);
  }
  expect(output).toBe("");
}, 60_000);
