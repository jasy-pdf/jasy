// The floor under `flexShrink`: a squeezed child stops at its `min-content` extent - CSS's automatic
// `min-width` on a flex item - instead of being ground down to one word per line.
import { describe, it, expect } from "vitest";
import { Box, Row, Expanded } from "../../../src/lib/api/layout.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { testMetrics } from "../support/metrics.ts";

const ctx = () =>
  ({ metrics: testMetrics(), pageConfig: { width: 595, height: 842, margin: 0 } }) as never;

const layout = (el: ReturnType<typeof Row>, width: number) =>
  el.calculateLayout(BoxConstraints.loose(width, Infinity), { x: 0, y: 0 }, ctx());

describe("min-content is the floor under shrinking", () => {
  it("a Text reports its longest word, not its whole line", () => {
    const t = Text("short Verpflichtungserklaerung short", { size: 12 });
    const whole = t.minIntrinsicMain(true, ctx());
    const shorter = Text("short short short", { size: 12 }).minIntrinsicMain(true, ctx());
    expect(whole).toBeGreaterThan(shorter);
    // The long word alone, measured on its own, is exactly what came back.
    expect(whole).toBeCloseTo(
      Text("Verpflichtungserklaerung", { size: 12 }).minIntrinsicMain(true, ctx()),
      6,
    );
  });

  it("breakWord lowers the floor to a single character", () => {
    const opts = { size: 12 } as const;
    const plain = Text("Verpflichtungserklaerung", opts).minIntrinsicMain(true, ctx());
    const broken = Text("Verpflichtungserklaerung", { ...opts, breakWord: true }).minIntrinsicMain(
      true,
      ctx(),
    );
    expect(broken).toBeLessThan(plain / 5);
  });

  it("stops squeezing a paragraph at its longest word instead of stacking it up", () => {
    const para = () =>
      Text("A paragraph with one Verpflichtungserklaerung inside it", { size: 12 });
    const floor = para().minIntrinsicMain(true, ctx());
    const child = Box({ width: 600 }, [para()]);
    // Offer far less than the floor: the child must stop there and overflow, not keep wrapping.
    layout(Row([child]), Math.round(floor / 3));
    expect(child.getProps().width as number).toBeGreaterThanOrEqual(floor - 0.01);
  });

  it("hands an unsqueezable child's share to the ones that can still give", () => {
    // Two children, 300pt each, in a 400pt line: 200pt has to go. The first cannot go below its long
    // word, so the second must absorb more than its own half.
    const wall = Box({ width: 300 }, [
      Text("Verpflichtungserklaerungsbescheinigung", { size: 14 }),
    ]);
    const soft = Box({ width: 300 });
    const row = Row({ gap: 0 }, [wall, soft]);
    layout(row, 400);
    const [a, b] = [wall.getProps().width as number, soft.getProps().width as number];
    expect(a + b).toBeLessThanOrEqual(400.01);
    expect(a).toBeGreaterThan(150); // it kept its word
    expect(b).toBeLessThan(150); // so the other gave up more than half
  });

  it("treats an explicit minWidth as the floor, and hands the rest to the neighbour", () => {
    // 2 x 300 in a 400pt line: 200 has to go. An equal split would put both at 200, but the first
    // refuses to go under 250 - so the second has to give up 150, not 100, or the line still overflows.
    const a = Box({ width: 300, minWidth: 250 }, []);
    const b = Box({ width: 300 }, []);
    layout(Row({ gap: 0 }, [a, b]), 400);
    expect(a.getProps().width).toBe(250);
    expect(b.getProps().width).toBe(150);
  });

  it("a flex child asking for a basis but no growth keeps its basis, not NaN", () => {
    // `flex: 0` with a basis makes `totalFlex` zero, and the share used to be 0/0. A NaN there becomes
    // the offset of every later sibling - the shape of the Spacer bug (#10).
    const e = Expanded({ flex: 0, flexBasis: 300 }, Box({ height: 20 }, []));
    const f = Box({ width: 300, height: 20 }, []);
    layout(Row({ gap: 0 }, [e, f]), 400);
    expect(Number.isFinite(e.getProps().width)).toBe(true);
    expect(e.getProps().width).toBe(300);
  });

  it("lets an explicit minWidth REPLACE the automatic floor, downwards too", () => {
    // `min-width: 0` is CSS's standard way to let a flex item shrink past its longest word. Taking the
    // larger of the two floors would quietly ignore it. Chrome on the same shape: 132.08pt with the
    // automatic minimum, 84.64pt with `min-width: 0`.
    const word = "Verpflichtungserklaerung";
    const auto = Box({ width: 300 }, [Text(word, { size: 12 })]);
    const zero = Box({ width: 300, minWidth: 0 }, [Text(word, { size: 12 })]);
    const floor = Text(word, { size: 12 }).minIntrinsicMain(true, ctx());

    layout(Row({ gap: 0 }, [auto, Box({ width: 300 }, [])]), 100);
    layout(Row({ gap: 0 }, [zero, Box({ width: 300 }, [])]), 100);

    expect(auto.getProps().width).toBeCloseTo(floor, 5);
    expect(zero.getProps().width).toBeLessThan(floor);
  });
});
