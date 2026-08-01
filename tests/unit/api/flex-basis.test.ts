import { describe, it, expect } from "vitest";
import { Box, Expanded, Row } from "../../../src/lib/api/layout.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// `flexBasis` is the main-axis size a flex child STARTS from, before the leftover is shared out. It is
// reserved exactly like a fixed child's size, so the leftover the others split shrinks by it.

const ctx = {} as LayoutContext;
const filler = (opts: Record<string, unknown> = {}) =>
  Expanded(opts as never, Box({ borderWidth: 0 }, []));

/** The laid-out width of each child of a 400pt Row. */
const widths = (children: unknown[], w = 400, gap = 0) => {
  const row = Row({ gap, width: w }, children as never);
  row.calculateLayout(BoxConstraints.loose(w, 200), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { width?: number } }[] }).children.map(
    (c) => c.getProps().width,
  );
};

describe("flexBasis", () => {
  it("is reserved before the rest is shared", () => {
    // 400 total, one child reserves 300, leaving 100. All three have flex 1, so each also takes a
    // third of that 100 - the basis child included.
    const [a, b, c] = widths([filler({ flexBasis: 300 }), filler(), filler()]);
    expect(a).toBeCloseTo(333.33, 1);
    expect(b).toBeCloseTo(33.33, 1);
    expect(c).toBeCloseTo(33.33, 1);
  });

  it("with flex 0 it is simply a fixed slot", () => {
    // Nothing to grow with, so the child is exactly its basis and the rest goes to the other.
    expect(widths([filler({ flex: 0, flexBasis: 120 }), filler()])).toEqual([120, 280]);
  });

  it("takes a percentage of what the line offers", () => {
    expect(widths([filler({ flex: 0, flexBasis: "25%" }), filler()])).toEqual([100, 300]);
  });

  it("resolves the percentage against the line MINUS the gaps", () => {
    // 400 - 20 of gap = 380 offered to the items; 25% of that is 95.
    expect(widths([filler({ flex: 0, flexBasis: "25%" }), filler()], 400, 20)).toEqual([95, 285]);
  });

  it("changes nothing when it is not set", () => {
    for (const w of widths([filler(), filler(), filler()])) expect(w).toBeCloseTo(400 / 3, 6);
  });

  it("shares the leftover by flex, on top of each basis", () => {
    // Bases 100 + 100 = 200 reserved; the remaining 200 splits 3:1.
    expect(
      widths([filler({ flex: 3, flexBasis: 100 }), filler({ flex: 1, flexBasis: 100 })]),
    ).toEqual([250, 150]);
  });
});
