import { describe, it, expect } from "vitest";
import { Document, Page, Box, Canvas } from "../../../src/lib/api/index.ts";
import { renderPdf } from "../../../src/lib/api/structure.ts";

// A canvas is a block IN the layout, never a way around it: it takes the box it is given, it clips
// to that box, and it paginates as one unbreakable unit.

const render = (element: unknown, options = {}) =>
  renderPdf(Document([Page([element as never])]), { compress: false, ...options });

describe("the box", () => {
  it("hands the callback the size it resolved to", async () => {
    let seen: { width: number; height: number } | undefined;
    await render(Canvas({ width: 120, height: 40 }, (_c, size) => void (seen = size)));
    expect(seen).toEqual({ width: 120, height: 40 });
  });

  it("fills what it is offered when no size is given", async () => {
    // Unlike an image there is no intrinsic size to fall back on.
    let seen = 0;
    await render(Box({ width: 200 }, [Canvas({ height: 30 }, (_c, s) => void (seen = s.width))]));
    expect(seen).toBe(200);
  });

  it("keeps the clip on the LAYOUT box even if the callback writes to its size", async () => {
    // The painter, the callback and the clip used to share one object, so `size.width = 999` moved
    // the clip away from the box the layout had reserved.
    const pdf = await render(
      Canvas({ width: 50, height: 20 }, (c, size) => {
        size.width = 999;
        (c as unknown as { size: { height: number } }).size.height = 999;
        c.rect(0, 0, 5, 5).fill();
      }),
    );
    // The clip rect the backend writes: "<x> <y> <w> <h> re".
    const clip = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/.exec(pdf);
    expect(clip?.slice(3, 5)).toEqual(["50", "20"]);
  });

  it("clips to its own box, so a drawing cannot bleed into the layout beside it", async () => {
    const pdf = await render(
      Canvas({ width: 50, height: 20 }, (c) => void c.rect(0, 0, 5, 5).fill()),
    );
    expect(pdf).toContain("W n");
  });
});

describe("what it draws reaches the page", () => {
  it("writes the fill colour into the content stream", async () => {
    const pdf = await render(
      Canvas({ width: 40, height: 20 }, (c) => void c.rect(0, 0, 10, 10).fill("#1450aa")),
    );
    expect(pdf).toContain("0.078 0.314 0.667 rg");
  });

  it("is a Figure with alt text, and decoration without it", async () => {
    const accessible = { accessible: true, title: "t", lang: "en" };
    const tagged = await render(
      Canvas({ width: 40, height: 20, alt: "A sparkline" }, (c) => void c.rect(0, 0, 9, 9).fill()),
      accessible,
    );
    expect(tagged).toContain("/Figure");
    expect(tagged).toContain("A sparkline");

    const plain = await render(
      Canvas({ width: 40, height: 20 }, (c) => void c.rect(0, 0, 9, 9).fill()),
      accessible,
    );
    expect(plain).not.toContain("/Figure");
  });

  it("takes the callback alone when the box comes from the layout", async () => {
    const pdf = await render(
      Box({ width: 60, height: 20 }, [Canvas((c) => void c.rect(0, 0, 9, 9).fill("#e2483d"))]),
    );
    expect(pdf).toContain("0.886 0.282 0.239 rg");
  });
});
