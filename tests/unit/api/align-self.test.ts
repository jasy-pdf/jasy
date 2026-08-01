import { describe, it, expect } from "vitest";
import { Box, Column, Expanded, Row } from "../../../src/lib/api/layout.ts";
import type { CrossAlign } from "../../../src/lib/layout/alignment.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

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

describe("a flex child is untouched by it", () => {
  it("gives an Expanded the container's cross constraint, whatever it asks for itself", () => {
    // Not reachable through the factories today - Expanded / Spacer have no `alignSelf` prop - but
    // `withAlignSelf` is public on the base element, so the path exists. The claim in the code is that
    // alignSelf is a NO-OP on a flex child; a no-op that changes the cross constraint is not one.
    //
    // The cross axis is left UNBOUNDED, which is the only place the line extent (the tallest child) and
    // the offered extent (Infinity) differ - so a regression here is visible rather than theoretical.
    const build = (self?: CrossAlign) => {
      const filler = Expanded({ flex: 1 }, Box({ borderWidth: 0 }, []));
      if (self) filler.withAlignSelf(self);
      return Row({ align: "stretch", width: 400 }, [
        Box({ borderWidth: 0, width: 40, height: 60 }, []),
        filler,
      ]);
    };
    const heightOf = (row: ReturnType<typeof Row>) => {
      row.calculateLayout(new BoxConstraints(0, 400, 0, Infinity), { x: 0, y: 0 }, ctx);
      const kids = (row as unknown as { children: { getProps(): { height?: number } }[] }).children;
      return kids[1].getProps().height;
    };
    expect(heightOf(build("start"))).toBe(heightOf(build()));
    expect(heightOf(build("end"))).toBe(heightOf(build()));
  });
});
