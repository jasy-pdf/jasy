import { describe, it, expect } from "vitest";
import { Box, Column, Expanded, Row } from "../../../src/lib/api/layout.ts";
import type { CrossAlign } from "../../../src/lib/layout/alignment.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { testMetrics } from "../support/metrics.ts";

// `alignSelf` - a child overriding its container's `align` (CSS align-self). The container decides for
// everyone; a child may disagree for itself.

const ctx = {} as LayoutContext;

/** The laid-out x of each child of a Row, which is what cross alignment moves in a Column. */
const childXs = (row: ReturnType<typeof Row>, w = 400, h = 200) => {
  row.calculateLayout(BoxConstraints.loose(w, h), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { x: number } }[] }).children.map(
    (c) => c.getProps().x,
  );
};

/** The laid-out y of each child of a Row - the CROSS axis there. */
const childYs = (row: ReturnType<typeof Row>, w = 400, h = 200) => {
  row.calculateLayout(BoxConstraints.loose(w, h), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { y: number } }[] }).children.map(
    (c) => c.getProps().y,
  );
};

const tile = (opts: Record<string, unknown> = {}) =>
  Box({ borderWidth: 0, width: 40, height: 20, ...opts }, []);

describe("alignSelf in a Row (cross axis = vertical)", () => {
  it("overrides the container for one child only", () => {
    const row = Row({ align: "start", height: 200 }, [
      tile(),
      tile({ alignSelf: "center" }),
      tile({ alignSelf: "end" }),
    ]);
    const [a, b, c] = childYs(row);
    expect(a).toBe(0); // follows the container: start
    expect(b).toBe(90); // (200 - 20) / 2
    expect(c).toBe(180); // 200 - 20
  });

  it("a child without it still follows the container", () => {
    const row = Row({ align: "end", height: 200 }, [tile(), tile({ alignSelf: "start" })]);
    const [a, b] = childYs(row);
    expect(a).toBe(180);
    expect(b).toBe(0);
  });

  it("stretch matches the tallest sibling where 'start' would not", () => {
    // The distinguishing setup: an UNBOUNDED cross axis, so the line's extent is the tallest child
    // rather than a given height. In a bounded Row a Box fills either way and the test proves nothing -
    // the first version of this one passed with alignSelf removed entirely.
    const tall = Box({ borderWidth: 0, width: 40, height: 60 }, []);
    const auto = Box({ borderWidth: 0, width: 40, alignSelf: "stretch" }, []);
    const row = Row({ align: "start" }, [tall, auto]);
    row.calculateLayout(new BoxConstraints(0, 400, 0, Infinity), { x: 0, y: 0 }, ctx);
    const kids = (row as unknown as { children: { getProps(): { height?: number } }[] }).children;
    expect(kids[0].getProps().height).toBe(60);
    expect(kids[1].getProps().height).toBe(60); // stretched to the line, not left at 0
  });
});

describe("alignSelf in a Column (cross axis = horizontal)", () => {
  it("moves the child across the width", () => {
    const col = Column({ align: "start", width: 400 }, [
      tile(),
      tile({ alignSelf: "center" }),
      tile({ alignSelf: "end" }),
    ]);
    col.calculateLayout(BoxConstraints.loose(400, 600), { x: 0, y: 0 }, ctx);
    const xs = (col as unknown as { children: { getProps(): { x: number } }[] }).children.map(
      (c) => c.getProps().x,
    );
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(180); // (400 - 40) / 2
    expect(xs[2]).toBe(360); // 400 - 40
  });
});

describe("nothing asked for changes nothing", () => {
  it("a Row without any alignSelf lays out as before", () => {
    const row = Row({ align: "center", height: 200 }, [tile(), tile()]);
    expect(childYs(row)).toEqual([90, 90]);
  });

  it("the horizontal positions are untouched by cross alignment", () => {
    const row = Row({ align: "end", gap: 10, height: 200 }, [tile(), tile({ alignSelf: "start" })]);
    expect(childXs(row)).toEqual([0, 50]);
  });
});

describe("an Expanded's child is the flex item, so it aligns like any other", () => {
  // `Expanded(child)` is `flex: 1` on the child: it fills the main axis, and across the line its own
  // `alignSelf` (or the container's `align`) places it.
  const inner = (opts: Record<string, unknown> = {}) =>
    Box({ borderWidth: 0, height: 20, ...opts }, []);
  const yOf = (row: ReturnType<typeof Row>, box: ReturnType<typeof Box>, h: number) => {
    row.calculateLayout(new BoxConstraints(0, 400, 0, h), { x: 0, y: 0 }, ctx);
    return box.getProps().y as number;
  };

  it("alignSelf moves it across a bounded line, and it still fills the main axis", () => {
    const centred = inner({ alignSelf: "center" });
    expect(yOf(Row({ height: 200 }, [tile(), Expanded(centred)]), centred, 200)).toBe(90);
    expect(centred.getProps().width).toBe(360); // 400 - the 40 wide tile
    const plain = inner();
    expect(yOf(Row({ height: 200 }, [tile(), Expanded(plain)]), plain, 200)).toBe(0);
  });

  it("on a line that shrink-wraps across, it aligns within the tallest sibling", () => {
    // Cross axis unbounded: the line is as tall as its tallest child (60), and `end` puts a 20 tall
    // child at 40 - against the line, not against the unbounded offer.
    const tall = Box({ borderWidth: 0, width: 40, height: 60 }, []);
    const ended = inner({ alignSelf: "end" });
    expect(yOf(Row([tall, Expanded(ended)]), ended, Infinity)).toBe(40);
  });

  it("the container's align reaches it too", () => {
    const box = inner();
    expect(yOf(Row({ height: 200, align: "end" }, [tile(), Expanded(box)]), box, 200)).toBe(180);
  });

  it("a text in it still wraps when it is not stretched", () => {
    // Why `alignSelf` used to be switched off on a flex child: measured across an UNBOUNDED axis, a text
    // in a Column never wraps. It is measured against the column's width instead.
    const metricsCtx = {
      metrics: testMetrics(),
      pageConfig: { width: 595, height: 842, margin: 0 },
    };
    const text = Text("a sentence that cannot fit on one line of a narrow column", { size: 12 });
    const box = Box({ borderWidth: 0, alignSelf: "start" }, [text]);
    Column({ height: 300 }, [Expanded(box)]).calculateLayout(
      BoxConstraints.loose(100, 300),
      { x: 0, y: 0 },
      metricsCtx as never,
    );
    expect(box.getProps().width as number).toBeLessThanOrEqual(100);
    expect(text.getProps().height as number).toBeGreaterThan(2 * 12);
  });
});
