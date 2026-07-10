import { describe, it, expect } from "vitest";
import { PositionedElement } from "../../../src/lib/elements/layout/positioned-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { layoutPageBands, PageElement, pageFrame } from "../../../src/lib/elements/page-element";
import { RectangleRenderer } from "../../../src/lib/renderer/rectangle-renderer";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { Orientation } from "../../../src/lib/renderer/pdf-config";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics";
import type { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { unitVerticals } from "../support/metrics";

const metrics: FontMetrics = {
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
  getFontVerticals: unitVerticals,
};
const ctx = { metrics } as LayoutContext;
// A `Positioned` refuses to lay out without a frame, so the out-of-flow tests below need one. It is
// never drained: they assert what the element does NOT do to the flow, not where the child lands.
const ctxWithFrame = {
  metrics,
  pageConfig: {},
  frame: { origin: { x: 0, y: 0 }, size: { width: 100, height: 100 }, place: [] },
} as LayoutContext;

// A fixed-size box with no border, easy to read coordinates off via getSize().
const fixed = (width: number, height: number) =>
  new RectangleElement({ x: 0, y: 0, width, height, borderWidth: 0, children: [] });

const frame = (opts: { width: number; height: number }, children: PositionedElement[]) =>
  new RectangleElement({
    x: 0,
    y: 0,
    width: opts.width,
    height: opts.height,
    borderWidth: 0,
    relative: true,
    children,
  });

describe("PositionedElement - out of flow", () => {
  it("takes zero space in the normal flow", () => {
    const positioned = new PositionedElement({ child: fixed(20, 10), top: 0, left: 0 });
    const size = positioned.calculateLayout(
      BoxConstraints.loose(100, 100),
      { x: 0, y: 0 },
      ctxWithFrame,
    );
    expect(size).toEqual({ width: 0, height: 0 });
  });

  it("does not push its siblings in a Column", () => {
    const a = fixed(30, 12);
    const b = fixed(30, 18);
    new ContainerElement({
      x: 0,
      y: 0,
      children: [a, new PositionedElement({ child: fixed(50, 50), top: 0, left: 0 }), b],
    }).calculateLayout(BoxConstraints.loose(100, Infinity), { x: 0, y: 0 }, ctxWithFrame);
    // b sits directly below a (12), unaffected by the 50-tall Positioned between them.
    expect(a.getSize().y).toBe(0);
    expect(b.getSize().y).toBe(12);
  });

  it("refuses to lay out with no frame, instead of silently drawing at (0, 0)", () => {
    // It used to fall through and leave the child at its default origin, which is how a header
    // watermark landed in the page corner without a word (ISSUE-4).
    const positioned = new PositionedElement({ child: fixed(20, 10), top: 50, left: 50 });
    expect(() =>
      positioned.calculateLayout(BoxConstraints.loose(100, 100), { x: 0, y: 0 }, ctx),
    ).toThrow(/no positioning frame/);
  });
});

describe("PositionedElement - placement against the frame", () => {
  it("anchors top/left to the frame origin (plus the frame's own offset)", () => {
    const child = fixed(20, 10);
    frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, top: 5, left: 8 }),
    ]).calculateLayout(BoxConstraints.loose(100, 60), { x: 30, y: 40 }, ctx);
    // frame origin = (30, 40); child = origin + (left, top).
    expect(child.getSize().x).toBe(38);
    expect(child.getSize().y).toBe(45);
  });

  it("anchors right/bottom to the opposite edge, accounting for the child size", () => {
    const child = fixed(20, 10);
    frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, right: 8, bottom: 5 }),
    ]).calculateLayout(BoxConstraints.loose(100, 60), { x: 0, y: 0 }, ctx);
    // x = 0 + 100 - 20 - 8; y = 0 + 60 - 10 - 5.
    expect(child.getSize().x).toBe(72);
    expect(child.getSize().y).toBe(45);
  });

  it("lets a negative offset poke outside the frame", () => {
    const child = fixed(24, 14);
    frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, top: -12, left: -10 }),
    ]).calculateLayout(BoxConstraints.loose(100, 60), { x: 50, y: 50 }, ctx);
    // (50 - 10, 50 - 12) - above and left of the frame's top-left corner.
    expect(child.getSize().x).toBe(40);
    expect(child.getSize().y).toBe(38);
  });
});

describe("PositionedElement - anchor + offset (Stage 4)", () => {
  // frame 100x60 at origin (0,0), child 20x10.
  const place = (insets: Record<string, unknown>) => {
    const child = fixed(20, 10);
    frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, ...insets }),
    ]).calculateLayout(BoxConstraints.loose(100, 60), { x: 0, y: 0 }, ctx);
    return child.getSize();
  };

  it("centers on an axis with h/v: center", () => {
    // x = (100-20)/2 = 40 ; y = (60-10)/2 = 25
    expect(place({ h: "center", v: "center" })).toMatchObject({ x: 40, y: 25 });
  });

  it("end-anchors to the far edge, accounting for the child size", () => {
    // x = 100-20 = 80 ; y = 60-10 = 50
    expect(place({ h: "end", v: "end" })).toMatchObject({ x: 80, y: 50 });
  });

  it("nudges from the anchor with x/y (center - 10, bottom - 8)", () => {
    expect(place({ h: "center", x: -10, v: "end", y: -8 })).toMatchObject({ x: 30, y: 42 });
  });

  it("defaults to the start anchor when only a nudge is given", () => {
    expect(place({ x: 12, y: 6 })).toMatchObject({ x: 12, y: 6 });
  });

  it("lets an edge win over an anchor on the same axis", () => {
    expect(place({ left: 5, h: "center" })).toMatchObject({ x: 5 });
  });
});

describe("PositionedElement - the page is the default frame", () => {
  it("anchors a page-level Positioned to the content box (no relative ancestor)", () => {
    const child = fixed(20, 10);
    const page = new PageElement({
      children: [new PositionedElement({ child, top: 5, left: 8 })],
      config: {
        pageSize: PageSize.A4,
        orientation: Orientation.portrait,
        margin: { top: 50, right: 50, bottom: 50, left: 50 },
      },
    });
    page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, {
      metrics,
      pageConfig: {},
    } as LayoutContext);
    // Content-box origin = the top-left margin (50, 50); child = origin + (left, top).
    expect(child.getSize().x).toBe(58);
    expect(child.getSize().y).toBe(55);
  });

  // ISSUE-4. A band used to be laid out BEFORE the frame existed, so a `Positioned` in it had
  // nothing to resolve against and its child stayed at (0, 0) - a watermark in the page corner.
  const A4_CONTENT = { top: 50, bottom: 791.89, left: 50, right: 545.28 }; // A4 minus a 50pt margin

  const pageWith = (bands: { header?: PositionedElement; footer?: PositionedElement }): void => {
    new PageElement({
      children: [fixed(10, 10)],
      config: {
        pageSize: PageSize.A4,
        orientation: Orientation.portrait,
        margin: { top: 50, right: 50, bottom: 50, left: 50 },
      },
      ...bands,
    }).calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, {
      metrics,
      pageConfig: {},
    } as LayoutContext);
  };

  it("anchors a Positioned in the HEADER to the page, exactly like one in the body", () => {
    const child = fixed(20, 10);
    pageWith({ header: new PositionedElement({ child, top: 5, left: 8 }) });
    expect(child.getSize().x).toBe(A4_CONTENT.left + 8);
    expect(child.getSize().y).toBe(A4_CONTENT.top + 5);
  });

  it("anchors a Positioned in the FOOTER to the page, so bottom:0 is the foot of the page", () => {
    const child = fixed(20, 10);
    pageWith({ footer: new PositionedElement({ child, bottom: 0, right: 0 }) });
    expect(child.getSize().x).toBe(A4_CONTENT.right - 20);
    expect(child.getSize().y).toBe(A4_CONTENT.bottom - 10);
  });

  it("registers a band's placement ONCE, though the footer subtree is laid out twice", () => {
    // `layoutPageBands` measures the footer to learn its height, then lays it out again at the
    // bottom edge. Without a throwaway frame for the measuring pass, its `Positioned` registers on
    // both and the child is placed twice.
    const config = {
      pageSize: PageSize.A4,
      orientation: Orientation.portrait,
      margin: { top: 50, right: 50, bottom: 50, left: 50 },
    };
    for (const band of ["header", "footer"] as const) {
      const frame = pageFrame(config);
      const positioned = new PositionedElement({ child: fixed(20, 10), top: 5, left: 5 });
      layoutPageBands(
        config,
        band === "header" ? positioned : undefined,
        band === "footer" ? positioned : undefined,
        { metrics, pageConfig: {}, frame } as LayoutContext,
      );
      expect(frame.place, `${band} registered more than once`).toHaveLength(1);
    }
  });

  it("resolves a Positioned nested inside another one, against the page", () => {
    // The drain loop must hand the callback a context that still carries the frame, and must pick up
    // the placements appended while it walks. Otherwise the inner one throws (or, before the throw
    // existed, silently drew in the page corner).
    const inner = fixed(10, 10);
    const outer = new RectangleElement({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      borderWidth: 0,
      children: [new PositionedElement({ child: inner, top: 10, left: 10 })],
    });
    new PageElement({
      children: [new PositionedElement({ child: outer, top: 100, left: 100 })],
      config: {
        pageSize: PageSize.A4,
        orientation: Orientation.portrait,
        margin: { top: 50, right: 50, bottom: 50, left: 50 },
      },
    }).calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, {
      metrics,
      pageConfig: {},
    } as LayoutContext);
    // The page is the nearest frame (the outer Positioned is not one), so 50 + 10 on both axes.
    expect(inner.getSize().x).toBe(60);
    expect(inner.getSize().y).toBe(60);
  });

  it("keeps a body Positioned put when a header is added (the frame is the page, not the body band)", () => {
    const child = fixed(20, 10);
    new PageElement({
      children: [new PositionedElement({ child, top: 5, left: 8 })],
      header: fixed(100, 40), // 40pt of header used to push the frame - and the child - down with it
      config: {
        pageSize: PageSize.A4,
        orientation: Orientation.portrait,
        margin: { top: 50, right: 50, bottom: 50, left: 50 },
      },
    }).calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, {
      metrics,
      pageConfig: {},
    } as LayoutContext);
    expect(child.getSize().y).toBe(A4_CONTENT.top + 5); // not 50 + 40 + 5
  });
});

describe("RectangleElement - overflow clips the children", () => {
  const laidOut = (overflow?: "hidden" | "visible") => {
    const rect = new RectangleElement({
      x: 0,
      y: 0,
      width: 50,
      height: 30,
      borderWidth: 0,
      overflow,
      children: [],
    });
    rect.calculateLayout(BoxConstraints.loose(50, 30), { x: 0, y: 0 }, ctx);
    return rect;
  };

  it('wraps children in clip-push/clip-pop when overflow is "hidden"', async () => {
    const nodes = await RectangleRenderer.render(laidOut("hidden"), {} as PDFObjectManager);
    expect(nodes.some((n) => n.type === "clip-push")).toBe(true);
    expect(nodes.some((n) => n.type === "clip-pop")).toBe(true);
  });

  it("emits no clip by default (visible) - byte-identical to before", async () => {
    const nodes = await RectangleRenderer.render(laidOut(), {} as PDFObjectManager);
    expect(nodes.some((n) => n.type === "clip-push" || n.type === "clip-pop")).toBe(false);
  });
});

describe("RectangleElement - width shrink-wrap under unbounded width", () => {
  it("shrink-wraps to the widest child (needed for a Box badge in a Positioned)", () => {
    const box = new RectangleElement({ x: 0, y: 0, borderWidth: 0, children: [fixed(40, 10)] });
    const size = box.calculateLayout(BoxConstraints.loose(Infinity, Infinity), { x: 0, y: 0 }, ctx);
    expect(size.width).toBe(40);
  });
});
