import { describe, it, expect } from "vitest";
import { Box, Column, Row } from "../../../src/lib/api/layout.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { Table } from "../../../src/lib/api/table.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { testMetrics } from "../support/metrics.ts";

// The flex work so far was tested with plain boxes. Real documents put a Table, a wrapping paragraph
// and nested stacks inside a flex item - and those RE-MEASURE differently when the item is made
// narrower. This suite is about that: does it still hold when the content is not a rectangle.

const ctx = { metrics: testMetrics() } as LayoutContext;

// The height is left UNBOUNDED on purpose: a Box with no height of its own FILLS a bounded region,
// which would make every height below read 600 and hide what these tests are about.
const laid = (el: ReturnType<typeof Row>, w: number, h = Infinity) => {
  el.calculateLayout(BoxConstraints.loose(w, h), { x: 0, y: 0 }, ctx);
  return (el as unknown as { children: { getProps(): Record<string, number> }[] }).children.map(
    (c) => c.getProps(),
  );
};

describe("percentage children in a wrapping row", () => {
  it("fits three 33% children on one line instead of wrapping the third", () => {
    // The trap: the line-assignment pass must resolve a `%` child against the SAME base the layout
    // uses - the line minus its gaps. Measuring against the full line makes each child a few points
    // too wide, and the third one wraps for no reason.
    const chip = () => Box({ borderWidth: 0, width: "33%", height: 20 }, []);
    const row = Row({ gap: 6, wrap: true, width: 300 }, [chip(), chip(), chip()]);
    expect(laid(row, 300).map((p) => p.y)).toEqual([0, 0, 0]);
  });

  it("wraps a fourth one, since four thirds do not fit", () => {
    const chip = () => Box({ borderWidth: 0, width: "33%", height: 20 }, []);
    const row = Row({ gap: 6, wrap: true, width: 300 }, [chip(), chip(), chip(), chip()]);
    // 20pt of chip plus the 6pt gap, which is used between the LINES as well as between the items.
    expect(laid(row, 300).map((p) => p.y)).toEqual([0, 0, 0, 26]);
  });
});

describe("a flex item holding real content", () => {
  const card = (text: string, opts: Record<string, unknown> = {}) =>
    Box({ borderWidth: 1, padding: 4, ...opts } as never, [
      Column({ gap: 2 }, [Text("Heading", { size: 10 }), Text(text, { size: 10 })]),
    ]);

  it("wraps cards whose height comes from their own text", () => {
    const row = Row({ gap: 6, wrap: true, width: 300 }, [
      card("aa bb", { width: 140 }),
      card("cc dd", { width: 140 }),
      card("ee ff", { width: 140 }),
    ]);
    const ys = laid(row, 300).map((p) => p.y);
    expect(ys[0]).toBe(0);
    expect(ys[1]).toBe(0);
    expect(ys[2]).toBeGreaterThan(0); // the third moved to line two
  });

  it("lets a shrunk card grow taller as its text re-wraps", () => {
    // The reason the shrink pass re-measures BEFORE the line's cross extent is settled: a narrower
    // card needs more lines, and a line sized against the natural width would clip it.
    const wide = Row({ width: 400 }, [card("aa bb cc dd ee ff", { width: 400 })]);
    const tall = laid(wide, 400)[0].height;

    const squeezed = Row({ width: 120 }, [
      card("aa bb cc dd ee ff", { width: 400, flexShrink: 1 }),
    ]);
    const squeezedHeight = laid(squeezed, 120)[0].height;

    expect(laid(squeezed, 120)[0].width).toBe(120); // it did shrink...
    expect(squeezedHeight).toBeGreaterThan(tall); // ...and got taller, not clipped
  });

  it("carries a Table through a wrapping row", () => {
    const cell = (t: string) => Text(t, { size: 10 });
    const panel = (w: number) =>
      Box({ borderWidth: 1, width: w }, [
        Table({ columns: ["1fr", "1fr"] }, [
          [cell("aa"), cell("bb")],
          [cell("cc"), cell("dd")],
        ]),
      ]);
    const row = Row({ gap: 6, wrap: true, width: 300 }, [panel(140), panel(140), panel(140)]);
    const out = laid(row, 300);
    expect(out.map((p) => p.y)).toEqual([out[0].y, out[0].y, out[2].y]);
    expect(out[2].y).toBeGreaterThan(out[0].y);
    for (const p of out) expect(p.height).toBeGreaterThan(0); // every panel really laid out
  });

  it("keeps a nested Column inside a shrinking item intact", () => {
    const inner = Box({ borderWidth: 0, width: 200, flexShrink: 1 }, [
      Column({ gap: 2 }, [Text("aa bb", { size: 10 }), Text("cc dd ee", { size: 10 })]),
    ]);
    const row = Row({ width: 100 }, [inner]);
    const out = laid(row, 100)[0];
    expect(out.width).toBe(100);
    expect(out.height).toBeGreaterThan(0);
  });
});
