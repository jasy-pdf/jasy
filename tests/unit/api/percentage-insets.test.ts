import { describe, it, expect } from "vitest";
import { Box, Padding } from "../../../src/lib/api/layout.ts";
import { Page } from "../../../src/lib/api/structure.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { toEdges } from "../../../src/lib/api/insets.ts";
import { resolveEdges } from "../../../src/lib/layout/insets.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// Percentage padding / margin. The rule worth testing is the surprising one: a percentage resolves
// against the available WIDTH on ALL FOUR sides, top and bottom included. That is CSS (and Yoga, so
// react-pdf agrees) - `padding-top: 10%` has never meant 10% of the height.

describe("toEdges keeps points as plain numbers", () => {
  it("does not change shape for an input that was already legal", () => {
    // `toEdges` is publicly exported; learning percentages must not break what it returned before.
    expect(toEdges(10)).toEqual([10, 10, 10, 10]);
    expect(toEdges({ x: 4, y: 8 })).toEqual([8, 4, 8, 4]);
    expect(toEdges([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("marks only a percentage side as unresolved", () => {
    expect(toEdges({ top: "10%", left: 6 })).toEqual([{ factor: 0.1 }, 0, 0, 6]);
  });
});

describe("resolveEdges", () => {
  it("uses the WIDTH for the vertical sides too", () => {
    // The whole point. 10% of a 400pt-wide box is 40 on every side, including top and bottom.
    expect(resolveEdges(toEdges("10%"), 400)).toEqual([40, 40, 40, 40]);
  });

  it("leaves a percentage at 0 when the width is unbounded", () => {
    // Same no-op a percentage SIZE gives there - a fraction of "unbounded" has no meaning.
    expect(resolveEdges(toEdges("10%"), Infinity)).toEqual([0, 0, 0, 0]);
  });

  it("mixes points and percentages per side", () => {
    expect(resolveEdges(toEdges({ top: "25%", right: 12, bottom: "5%", left: 0 }), 200)).toEqual([
      50, 12, 10, 0,
    ]);
  });
});

describe("through the factories", () => {
  const ctx = {} as LayoutContext;
  const height = (el: ReturnType<typeof Padding>, w = 400) =>
    el.calculateLayout(BoxConstraints.loose(w, 1000), { x: 0, y: 0 }, ctx).height;

  it("a Padding of '10%' insets by 10% of the offered width", () => {
    // An empty box as the child, so the height IS the vertical insets: 2 x 10% of 400.
    const el = Padding("10%", Box({ borderWidth: 0, height: 0 }, []));
    expect(height(el, 400)).toBe(80);
    // ... and it tracks the offered width, not a frozen number.
    expect(height(Padding("10%", Box({ borderWidth: 0, height: 0 }, [])), 200)).toBe(40);
  });

  it("a Box padding takes one too", () => {
    // Height left UNBOUNDED so the box shrink-wraps to its content - in a bounded region a Box fills,
    // and the insets would be invisible in the result.
    const el = Box({ borderWidth: 0, padding: "5%" }, [Box({ borderWidth: 0, height: 0 }, [])]);
    const size = el.calculateLayout(BoxConstraints.loose(300, Infinity), { x: 0, y: 0 }, ctx);
    expect(size.height).toBe(30); // 2 x 5% of 300
  });

  it("a page margin resolves against the page width", () => {
    // The page is the one box whose geometry needs no parent, so this resolves at build time.
    const page = Page({ size: "A4", margin: "10%" }, [Text("hi")]);
    const m = (page as unknown as { config: { margin: Record<string, number> } }).config.margin;
    // A4 is 595.28pt wide.
    expect(m.top).toBeCloseTo(59.528, 3);
    expect(m.left).toBeCloseTo(59.528, 3);
  });

  it("a landscape page uses the ROTATED width", () => {
    const page = Page({ size: "A4", orientation: "landscape", margin: "10%" }, [Text("hi")]);
    const m = (page as unknown as { config: { margin: Record<string, number> } }).config.margin;
    expect(m.top).toBeCloseTo(84.189, 3); // 10% of 841.89, not of 595.28
  });
});
