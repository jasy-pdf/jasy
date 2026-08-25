import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `maximalInvoice` claims to set EVERY field of the model. This checks the claim.
 *
 * It exists because the claim was once false: a second fixture of the same name, used by the order
 * tests, was missing six field names - `reasonCode` and `vatExemptionReasons` among them. A fixture
 * that is "maximal" by NAME quietly stops covering what it is supposed to cover, and every test
 * built on it goes green for the wrong reason.
 */

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

/** Every property name declared in the invoice model, at any nesting level. */
function modelFields(): string[] {
  const source = read("src/invoice.ts");
  const names = [...source.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  return [...new Set(names)];
}

describe("the maximal fixture really is maximal", () => {
  const fixture = read("tests/support/maximal.ts");
  const fields = modelFields();

  it("found the model at all", () => {
    expect(fields.length).toBeGreaterThan(50);
    expect(fields).toContain("vatExemptionReasons");
    expect(fields).toContain("reasonCode");
  });

  it.each(fields)("sets %s", (field) => {
    expect(new RegExp(`\\b${field}\\b`).test(fixture)).toBe(true);
  });

  it("is the only one of its kind", () => {
    // Two fixtures called "maximal" is how the first one drifted. The others must import this.
    for (const file of [
      "tests/completeness.test.ts",
      "tests/cii-order.test.ts",
      "tests/ubl-order.test.ts",
    ]) {
      expect(read(file), file).toContain("support/maximal");
      expect(read(file), file).not.toMatch(/const maximal(Invoice)?\s*:\s*Invoice\s*=\s*\{/);
    }
  });
});
