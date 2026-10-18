import { describe, it, expect } from "vitest";
import { Jimp } from "jimp";
import {
  Column,
  Document,
  Image,
  Page,
  Row,
  Text,
  renderToBytes,
} from "../../../src/lib/api/index.ts";
import { drawnNodes } from "../support/drawn.ts";

// An image given no size is drawn at its own pixel size (1px = 1pt), scaled down to what it is offered
// and never up, so it cannot run off the page. Smaller than its slot, it is placed by `align` like any
// other child. Either way the box it reserves is the one it is drawn in.

const png = async (width: number, height: number) =>
  new Uint8Array(await new Jimp({ width, height, color: 0x00ff00ff }).getBuffer("image/png"));

// A 200pt page with a 30pt margin: a Column offers 140pt.
const drawn = async (body: ReturnType<typeof Column>) => {
  const page = Page({ size: { width: 200, height: 400 }, margin: 30 }, [body]);
  const [nodes] = await drawnNodes(() => renderToBytes(Document([page])));
  const images = nodes!.filter((n) => n.type === "image") as {
    x: number;
    y: number;
    width: number;
    height: number;
    clip?: unknown;
  }[];
  const text = nodes!.find((n) => n.type === "text") as { x: number; y: number };
  return { images, text };
};
const box = (i: { x: number; y: number; width: number; height: number }) => [
  i.x,
  i.y,
  i.width,
  i.height,
];

describe("an unsized image", () => {
  it("in a Column keeps its own size; a wider one is scaled down to the column, ratio kept", async () => {
    const { images, text } = await drawn(
      Column([Image(await png(60, 30)), Image(await png(400, 30)), Text("after")]),
    );
    expect(images.map(box)).toEqual([
      [30, 30, 60, 30],
      [30, 60, 140, 10.5],
    ]);
    expect(images.every((i) => i.clip === undefined)).toBe(true); // drawn filled, nothing to cut
    expect(text.y).toBeGreaterThanOrEqual(70.5);
  });

  it("is placed by the Column's align, as any child smaller than its slot", async () => {
    const { images } = await drawn(Column({ align: "center" }, [Image(await png(60, 30))]));
    expect(images.map(box)).toEqual([[70, 30, 60, 30]]);
  });

  it("in a Row keeps its own size, and a Row of fixed height scales it down to fit", async () => {
    const { images, text } = await drawn(
      Column([
        Row([Image(await png(60, 30)), Text("after")]),
        Row({ height: 20 }, [Image(await png(60, 30))]),
      ]),
    );
    expect(images.map(box)).toEqual([
      [30, 30, 60, 30],
      [30, 60, 40, 20],
    ]);
    expect(text.x).toBeGreaterThanOrEqual(90);
  });
});

describe("align on an image: where it sits in its own box", () => {
  const cut = async (w: number, h: number, align?: "top" | "bottom right" | "left") => {
    const { images } = await drawn(
      Column([Image(await png(w, h), { width: 30, height: 30, fit: "cover", align })]),
    );
    return box(images[0]!);
  };

  it("centred by default", async () => {
    expect(await cut(30, 60)).toEqual([30, 15, 30, 60]);
  });

  it('"top" keeps the top of a portrait in a cover box', async () => {
    expect(await cut(30, 60, "top")).toEqual([30, 30, 30, 60]);
  });

  it("moves the overhang on both axes", async () => {
    expect(await cut(60, 30, "left")).toEqual([30, 30, 60, 30]);
    expect(await cut(60, 30, "bottom right")).toEqual([0, 30, 60, 30]);
  });
});
