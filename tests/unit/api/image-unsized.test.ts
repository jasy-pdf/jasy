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

// An image given no size is drawn at its own pixel size (1px = 1pt, `fit: none`). On an axis with no
// bound it reserved NOTHING, so the next sibling was drawn on top of it.

const png = async () =>
  new Uint8Array(
    await new Jimp({ width: 40, height: 20, color: 0x00ff00ff }).getBuffer("image/png"),
  );

const drawn = async (body: (img: Uint8Array) => ReturnType<typeof Column>) => {
  const img = await png();
  const [nodes] = await drawnNodes(() => renderToBytes(Document([Page([body(img)])])));
  const image = nodes!.find((n) => n.type === "image") as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const text = nodes!.find((n) => n.type === "text") as { x: number; y: number };
  return { image, text };
};

describe("an unsized image reserves what it draws", () => {
  it("in a Column: the next line starts below it", async () => {
    const { image, text } = await drawn((img) => Column([Image(img), Text("after")]));
    expect([image.width, image.height]).toEqual([40, 20]);
    expect(text.y).toBeGreaterThanOrEqual(image.y + image.height);
  });

  it("in a Row: the next item starts after it", async () => {
    const { image, text } = await drawn((img) => Row([Image(img), Text("after")]));
    expect([image.width, image.height]).toEqual([40, 20]);
    expect(text.x).toBeGreaterThanOrEqual(image.x + image.width);
  });
});
