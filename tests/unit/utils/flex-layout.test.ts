import { describe, it, expect } from "vitest";
import {
  FlexLayoutHelper,
  VERTICAL_AXIS,
  HORIZONTAL_AXIS,
} from "../../../src/lib/utils/flex-layout";
import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
  VerticalAlignment,
} from "../../../src/lib/elements/pdf-element";
import { BoxConstraints, Offset, Size } from "../../../src/lib/layout/box-constraints";

// The helper PLACES children (calls calculateLayout with their offset), so the mocks
// record where they were placed and report a fixed size.
class MockBox extends PDFElement {
  placedAt?: Offset;
  constructor(private size: Size) {
    super();
  }
  getProps(): unknown {
    return {};
  }
  calculateLayout(_c: BoxConstraints, offset: Offset): Size {
    this.placedAt = offset;
    return this.size;
  }
}

class MockFlex extends FlexiblePDFElement {
  placedAt?: Offset;
  constructor(flex: number) {
    super({ flex, verticalChildAlignment: VerticalAlignment.top });
  }
  getProps(): unknown {
    return {};
  }
  calculateLayout(c: BoxConstraints, offset: Offset): Size {
    this.placedAt = offset;
    return {
      width: c.maxWidth === Infinity ? 0 : c.maxWidth,
      height: c.maxHeight === Infinity ? 0 : c.maxHeight,
    };
  }
}

const ctx = {} as LayoutContext;

describe("FlexLayoutHelper.layout - vertical (Column)", () => {
  it("stacks fixed then splits leftover among flex, in source order", () => {
    const f1 = new MockBox({ width: 0, height: 100 });
    const f2 = new MockBox({ width: 0, height: 50 });
    const x1 = new MockFlex(1);
    const x2 = new MockFlex(2);

    const r = FlexLayoutHelper.layout([f1, f2, x1, x2], VERTICAL_AXIS, 500, 0, 0, 0, {}, ctx);

    expect(f1.placedAt!.y).toBe(0);
    expect(f2.placedAt!.y).toBe(100);
    expect(x1.placedAt!.y).toBe(150);
    expect(x2.placedAt!.y).toBeCloseTo(150 + 350 / 3, 5);
    expect(r.mainUsed).toBeCloseTo(500, 5);
  });

  it("puts a fixed child after a flex child below it (footer at the bottom)", () => {
    const header = new MockBox({ width: 0, height: 100 });
    const body = new MockFlex(1);
    const footer = new MockBox({ width: 0, height: 50 });

    FlexLayoutHelper.layout([header, body, footer], VERTICAL_AXIS, 500, 0, 0, 0, {}, ctx);

    expect(footer.placedAt!.y).toBe(450); // 100 + (500 - 150)
  });

  it("inserts the gap and reports the main extent used", () => {
    const a = new MockBox({ width: 0, height: 100 });
    const b = new MockBox({ width: 0, height: 50 });

    const r = FlexLayoutHelper.layout([a, b], VERTICAL_AXIS, 500, 0, 0, 0, { gap: 10 }, ctx);

    expect(b.placedAt!.y).toBe(110);
    expect(r.mainUsed).toBe(160);
  });
});

describe("FlexLayoutHelper.layout - main-axis distribution (no flex)", () => {
  const boxes = () => [
    new MockBox({ width: 0, height: 100 }),
    new MockBox({ width: 0, height: 50 }),
  ];

  it("center: the group is centered, leftover split before/after", () => {
    const [a, b] = boxes();
    FlexLayoutHelper.layout([a, b], VERTICAL_AXIS, 500, 0, 0, 0, { main: "center" }, ctx);
    // leftover 350 -> leading 175.
    expect(a.placedAt!.y).toBe(175);
    expect(b.placedAt!.y).toBe(275);
  });

  it("end: the group is pushed to the end", () => {
    const [a, b] = boxes();
    FlexLayoutHelper.layout([a, b], VERTICAL_AXIS, 500, 0, 0, 0, { main: "end" }, ctx);
    expect(a.placedAt!.y).toBe(350); // leftover before
    expect(b.placedAt!.y).toBe(450);
  });

  it("between: leftover goes between the children", () => {
    const [a, b] = boxes();
    FlexLayoutHelper.layout([a, b], VERTICAL_AXIS, 500, 0, 0, 0, { main: "between" }, ctx);
    expect(a.placedAt!.y).toBe(0);
    expect(b.placedAt!.y).toBe(450); // 100 + leftover 350 between the two
  });
});

describe("FlexLayoutHelper.layout - cross-axis alignment", () => {
  it("center: a narrow child is centered across the cross extent", () => {
    const child = new MockBox({ width: 40, height: 20 });
    FlexLayoutHelper.layout(
      [child],
      VERTICAL_AXIS,
      /*main*/ 500,
      /*crossAvail*/ 100,
      0,
      0,
      { cross: "center" },
      ctx
    );
    expect(child.placedAt!.x).toBe(30); // (100 - 40) / 2
  });

  it("end: a narrow child is pushed to the cross end", () => {
    const child = new MockBox({ width: 40, height: 20 });
    FlexLayoutHelper.layout([child], VERTICAL_AXIS, 500, 100, 0, 0, { cross: "end" }, ctx);
    expect(child.placedAt!.x).toBe(60); // 100 - 40
  });
});

describe("FlexLayoutHelper.layout - horizontal (Row), same algorithm", () => {
  it("lays children left-to-right with a gap; cross = tallest child", () => {
    const a = new MockBox({ width: 30, height: 12 });
    const b = new MockBox({ width: 40, height: 20 });

    const r = FlexLayoutHelper.layout([a, b], HORIZONTAL_AXIS, 500, 100, 0, 0, { gap: 8 }, ctx);

    expect(a.placedAt!.x).toBe(0);
    expect(b.placedAt!.x).toBe(38);
    expect(r.crossUsed).toBe(20);
  });

  it("vertically centers a short child in the row (cross: center)", () => {
    const tall = new MockBox({ width: 30, height: 40 });
    const short = new MockBox({ width: 30, height: 10 });

    FlexLayoutHelper.layout([tall, short], HORIZONTAL_AXIS, 500, Infinity, 0, 0, { cross: "center" }, ctx);

    expect(tall.placedAt!.y).toBe(0); // tallest -> defines the cross extent (40)
    expect(short.placedAt!.y).toBe(15); // (40 - 10) / 2
  });
});
