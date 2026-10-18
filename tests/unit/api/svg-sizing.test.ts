import { describe, it, expect } from "vitest";
import { Column, Document, Image, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { drawnNodes } from "../support/drawn.ts";

// An SVG through `Image` sizes by the image contract: its own size, scaled down to what it is offered
// and never up, the open axis following its ratio. Its box is what it clips to.

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="red"/></svg>`;

// A 200pt page with a 30pt margin: a Column offers 140pt.
const boxOf = async (body: ReturnType<typeof Column>) => {
  const page = Page({ size: { width: 200, height: 400 }, margin: 30 }, [body]);
  const [nodes] = await drawnNodes(() => renderToBytes(Document([page])));
  const clip = nodes!.find((n) => n.type === "clip-push") as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  return [clip.x, clip.y, clip.width, clip.height];
};

describe("an SVG through Image", () => {
  it("unsized, keeps its own size", async () => {
    expect(await boxOf(Column([Image(svg(60, 30))]))).toEqual([30, 30, 60, 30]);
  });

  it("unsized and wider than the column, is scaled down at its ratio - no empty band below", async () => {
    expect(await boxOf(Column([Image(svg(400, 30))]))).toEqual([30, 30, 140, 10.5]);
  });

  it("is placed by the Column's align", async () => {
    expect(await boxOf(Column({ align: "center" }, [Image(svg(60, 30))]))).toEqual([
      70, 30, 60, 30,
    ]);
  });

  it("names what it does not support instead of ignoring it", () => {
    expect(() => Image(svg(60, 30), { align: "top" })).toThrow(/align is not supported for an SVG/);
    expect(() => Image(svg(60, 30), { fit: "cover" })).toThrow(/not supported for an SVG/);
  });
});
