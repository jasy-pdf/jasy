import { describe, it, expect, vi, afterEach } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/index.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { deeplyNested } from "../support/deep-nesting.ts";

// How often a leaf is laid out per render must not grow with how deep it is nested. It used to double
// at every flex level - measured, then laid out again to be placed - so 48 leaves eight levels deep
// were laid out 10,240 times each. A regression back to that fails here, not in a benchmark.

afterEach(() => vi.restoreAllMocks());

const layoutsPerLeaf = async (depth: number) => {
  const spy = vi.spyOn(TextElement.prototype, "calculateLayout");
  await renderToBytes(Document([Page({ size: "A3", margin: 20 }, deeplyNested(depth))]));
  return spy.mock.calls.length / 48;
};

describe("layout cost does not grow with nesting depth", () => {
  it("a leaf eight levels deep is laid out a handful of times, not 2^8", async () => {
    expect(await layoutsPerLeaf(8)).toBeLessThanOrEqual(3);
  });

  it("depth does not change it", async () => {
    expect(await layoutsPerLeaf(8)).toBe(await layoutsPerLeaf(2));
  });
});
