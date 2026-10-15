import { describe, it, expect } from "vitest";
import { PositionedElement } from "../../../src/lib/elements/layout/positioned-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { RectangleRenderer } from "../../../src/lib/renderer/rectangle-renderer";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { Orientation } from "../../../src/lib/renderer/pdf-config";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import type { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { testMetrics } from "../support/metrics.ts";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry.ts";
import { PositionedRenderer } from "../../../src/lib/renderer/positioned-renderer.ts";

// Rendering a frame on its own: its renderers are registered here, as `PDFRenderer.render` would.
RendererRegistry.register(RectangleElement, RectangleRenderer.render);
RendererRegistry.register(PositionedElement, PositionedRenderer.render);

const metrics = testMetrics({
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
});
const ctx = { metrics } as LayoutContext;
// A `Positioned` refuses to lay out without a frame, so the out-of-flow tests below need one. They
// assert what the element does NOT do to the flow, not where the child lands.
const ctxWithFrame = {
  metrics,
  pageConfig: {},
  frame: { origin: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
} as LayoutContext;

// A placement is an offset RELATIVE to the frame's top-left; the frame draws it from there. This is
// where it ends up on the page when `frame` is rendered at the page origin.
const drawnAt = async (frameEl: RectangleElement, child: RectangleElement) => {
  const { width, height } = child.getSize();
  const nodes = await RectangleRenderer.render(frameEl, {} as PDFObjectManager, { x: 0, y: 0 });
  const box = nodes.find((n) => n.type === "rect" && n.width === width && n.height === height);
  return box && box.type === "rect" ? { x: box.x, y: box.y } : undefined;
};

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
  it("anchors top/left to the frame origin (plus the frame's own offset)", async () => {
    const child = fixed(20, 10);
    const f = frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, top: 5, left: 8 }),
    ]);
    f.calculateLayout(BoxConstraints.loose(100, 60), { x: 30, y: 40 }, ctx);
    // Relative to the frame: (left, top). Drawn at the frame's origin (30, 40) plus that.
    expect(child.getSize().x).toBe(8);
    expect(child.getSize().y).toBe(5);
    expect(await drawnAt(f, child)).toEqual({ x: 38, y: 45 });
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

  it("lets a negative offset poke outside the frame", async () => {
    const child = fixed(24, 14);
    const f = frame({ width: 100, height: 60 }, [
      new PositionedElement({ child, top: -12, left: -10 }),
    ]);
    f.calculateLayout(BoxConstraints.loose(100, 60), { x: 50, y: 50 }, ctx);
    // Above and left of the frame's top-left corner: drawn at (50 - 10, 50 - 12).
    expect(child.getSize().x).toBe(-10);
    expect(child.getSize().y).toBe(-12);
    expect(await drawnAt(f, child)).toEqual({ x: 40, y: 38 });
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
    // Relative to the content box, which the page draws from its top-left margin (50, 50).
    expect(child.getSize().x).toBe(8);
    expect(child.getSize().y).toBe(5);
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
    expect(child.getSize().x).toBe(8);
    expect(child.getSize().y).toBe(5);
  });

  it("anchors a Positioned in the FOOTER to the page, so bottom:0 is the foot of the page", () => {
    const child = fixed(20, 10);
    pageWith({ footer: new PositionedElement({ child, bottom: 0, right: 0 }) });
    expect(child.getSize().x).toBe(A4_CONTENT.right - A4_CONTENT.left - 20);
    expect(child.getSize().y).toBe(A4_CONTENT.bottom - A4_CONTENT.top - 10);
  });

  it("places a band's Positioned ONCE, though the footer is measured and then laid out", () => {
    // `layoutPageBands` measures the footer to learn its height, then lays it out at the bottom edge.
    // Placement is the page's job after layout, so measuring can never add a second one.
    for (const band of ["header", "footer"] as const) {
      const positioned = new PositionedElement({ child: fixed(20, 10), top: 5, left: 5 });
      const page = new PageElement({
        children: [fixed(10, 10)],
        config: {
          pageSize: PageSize.A4,
          orientation: Orientation.portrait,
          margin: { top: 50, right: 50, bottom: 50, left: 50 },
        },
        [band]: positioned,
      });
      page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, {
        metrics,
        pageConfig: {},
      } as LayoutContext);
      expect(page.positionedContent(), `${band} placed more than once`).toEqual([positioned]);
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
    // The page is the nearest frame (the outer Positioned is not one): (10, 10) from its content box,
    // not from the outer one's box at (100, 100).
    expect(inner.getSize().x).toBe(10);
    expect(inner.getSize().y).toBe(10);
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
    expect(child.getSize().y).toBe(5); // from the content box, not from below the 40pt header
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
    const nodes = await RectangleRenderer.render(laidOut("hidden"), {} as PDFObjectManager, {
      x: 0,
      y: 0,
    });
    expect(nodes.some((n) => n.type === "clip-push")).toBe(true);
    expect(nodes.some((n) => n.type === "clip-pop")).toBe(true);
  });

  it("emits no clip by default (visible) - byte-identical to before", async () => {
    const nodes = await RectangleRenderer.render(laidOut(), {} as PDFObjectManager, { x: 0, y: 0 });
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
