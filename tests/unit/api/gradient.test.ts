import { describe, it, expect } from "vitest";
import { linearGradient, radialGradient, resolveGradient } from "../../../src/lib/api/gradient.ts";
import { Box, Column, Document, Page, renderPdf } from "../../../src/lib/api/index.ts";

// Gradients are written BOX-RELATIVE (an angle and stops) and resolved against the box by the
// renderer. Two things are worth pinning down: the angle convention, and that a solid colour still
// takes the old path - `sh` floods the clip, so a gradient box is painted completely differently.

const box = (g: unknown) => resolveGradient(g as never, 0, 0, 200, 100);

describe("the angle follows CSS: 0 points up, clockwise", () => {
  it("90 runs left to right, along the horizontal centre line", () => {
    const g = box(linearGradient({ angle: 90, stops: ["#000", "#fff"] })) as {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
    expect(g.y0).toBeCloseTo(50, 6);
    expect(g.y1).toBeCloseTo(50, 6);
    expect(g.x0).toBeLessThan(g.x1);
  });

  it("the default (180) runs top to bottom", () => {
    const g = box(linearGradient("#000", "#fff")) as { x0: number; y0: number; y1: number };
    expect(g.x0).toBeCloseTo(100, 6);
    expect(g.y0).toBeLessThan(g.y1); // engine coordinates run downwards
  });

  it("0 runs bottom to top - the opposite of the default", () => {
    const up = box(linearGradient({ angle: 0, stops: ["#000", "#fff"] })) as {
      y0: number;
      y1: number;
    };
    const down = box(linearGradient({ angle: 180, stops: ["#000", "#fff"] })) as {
      y0: number;
      y1: number;
    };
    expect(up.y0).toBeCloseTo(down.y1, 6);
    expect(up.y1).toBeCloseTo(down.y0, 6);
  });

  it("a diagonal spans the whole box, not just the shorter side", () => {
    // Half the box's extent along the axis - which is why 45 degrees reaches into the corners
    // instead of stopping short of them.
    const g = box(linearGradient({ angle: 45, stops: ["#000", "#fff"] })) as {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
    const span = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    expect(span).toBeCloseTo((200 + 100) / Math.SQRT2, 4);
  });
});

describe("stops", () => {
  it("spreads them evenly when nothing is pinned", () => {
    const g = box(linearGradient("#000", "#888", "#fff"));
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it("honours a pinned position", () => {
    const g = box(
      linearGradient({ angle: 90, stops: ["#000", { color: "#f3dc29", at: 0.8 }, "#fff"] }),
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.8, 1]);
  });

  it("refuses a gradient with fewer than two colours", () => {
    expect(() => box(linearGradient("#000"))).toThrow(/two colour stops/);
  });

  it("refuses a position outside 0..1, or one that is not a number", () => {
    // These end up in a PDF stitching function's /Bounds, which the format requires to sit strictly
    // inside the domain. A bad one is a MALFORMED FILE, not a wrong-looking gradient.
    for (const at of [2, -0.5, NaN, Infinity]) {
      expect(() => box(linearGradient({ stops: ["#000", { color: "#fff", at }, "#111"] }))).toThrow(
        /between 0 and 1/,
      );
    }
  });

  it("refuses stops that do not move forward", () => {
    // /Bounds must be STRICTLY increasing. Equal offsets are a hard colour edge in CSS and cannot be
    // expressed in one PDF shading, so they are named rather than drawn wrongly.
    expect(() =>
      box(
        linearGradient({
          stops: ["#000", { color: "#f00", at: 0.5 }, { color: "#0f0", at: 0.5 }, "#fff"],
        }),
      ),
    ).toThrow(/must move forward/);
    expect(() =>
      box(
        linearGradient({
          stops: ["#000", { color: "#f00", at: 0.8 }, { color: "#0f0", at: 0.3 }, "#fff"],
        }),
      ),
    ).toThrow(/must move forward/);
  });

  it("carries the edge colour outwards when the first or last stop is pinned inside", () => {
    // Only the INTERIOR offsets reach /Bounds - the domain is always 0..1 - so a first stop pinned at
    // 0.3 would silently do nothing. CSS extends the edge colour instead, and so do we.
    const g = box(
      linearGradient({
        stops: [
          { color: "#000000", at: 0.3 },
          { color: "#ffffff", at: 0.7 },
        ],
      }),
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.3, 0.7, 1]);
    expect(g.stops[0].color.toPDFColorString()).toBe(g.stops[1].color.toPDFColorString());
    expect(g.stops[3].color.toPDFColorString()).toBe(g.stops[2].color.toPDFColorString());
  });
});

describe("radial", () => {
  it("is centred and reaches the edges by default", () => {
    const g = box(radialGradient("#fff", "#000")) as {
      x0: number;
      y0: number;
      r0: number;
      r1: number;
    };
    expect([g.x0, g.y0]).toEqual([100, 50]);
    expect(g.r0).toBe(0);
    expect(g.r1).toBe(100); // half the larger side
  });

  it("takes a centre and radius of its own", () => {
    const g = box(
      radialGradient({ center: [0.25, 0.25], radius: 0.8, stops: ["#fff", "#000"] }),
    ) as { x0: number; y0: number; r1: number };
    expect([g.x0, g.y0]).toEqual([50, 25]);
    expect(g.r1).toBe(160);
  });
});

describe("what reaches the page", () => {
  const draw = async (bg: unknown) =>
    renderPdf(
      Document([
        Page({ margin: 40 }, [
          Column([Box({ bg, borderWidth: 0, width: 200, height: 100 } as never, [])]),
        ]),
      ]),
      { compress: false },
    );

  it("paints a gradient as a clip plus a shading, never as a fill colour", async () => {
    // PDF has no gradient FILL - `sh` floods the current clip - so the box becomes the clip.
    const pdf = await draw(linearGradient("#000000", "#ffffff"));
    expect(pdf).toMatch(/W n\n\/Sh\d+ sh/);
    expect(pdf).toContain("/Shading");
  });

  it("leaves a solid colour on the old path", async () => {
    const pdf = await draw("#dddddd");
    expect(pdf).toContain("re f");
    expect(pdf).not.toContain(" sh\n");
  });

  it("flips the gradient anchors with the box", async () => {
    // The IR is top-left; the anchors are absolute page coordinates and must flip WITH the rect, or
    // the gradient runs the wrong way round on the page.
    const pdf = await draw(linearGradient({ angle: 180, stops: ["#000000", "#ffffff"] }));
    const coords = /\/Coords \[([\d.\- ]+)\]/.exec(pdf);
    expect(coords).not.toBeNull();
    const [, y0, , y1] = coords![1].trim().split(/\s+/).map(Number);
    // The box sits at y 701.89..801.89 in PDF space; "downwards" means from the HIGH y to the low.
    expect(y0).toBeGreaterThan(y1);
  });

  it("still strokes a border around a gradient box", async () => {
    const pdf = await renderPdf(
      Document([
        Page({ margin: 40 }, [
          Column([
            Box(
              {
                bg: linearGradient("#000000", "#ffffff"),
                border: "#ff0000",
                borderWidth: 2,
                width: 200,
                height: 100,
              } as never,
              [],
            ),
          ]),
        ]),
      ]),
      { compress: false },
    );
    expect(pdf).toMatch(/ sh\n/);
    expect(pdf).toContain("2 w");
    expect(pdf).toMatch(/re S/);
  });
});
