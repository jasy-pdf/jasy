import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { Document, Image, Page, Padding, Text, renderPdf } from "../../../src/lib/api/index.ts";
import { drawnNodes } from "../support/drawn.ts";

describe('Image fit: "none"', () => {
  it.each([
    { name: "overflows both axes", width: 20, height: 10, x: 25, y: 30 },
    { name: "overflows horizontally", width: 20, height: 50, x: 25, y: 50 },
    { name: "overflows vertically", width: 80, height: 10, x: 55, y: 30 },
    { name: "fits inside the box", width: 80, height: 50, x: 55, y: 50 },
    { name: "matches the box", width: 60, height: 30, x: 45, y: 40 },
  ])("keeps its natural size and centres when it $name", async ({ width, height, x, y }) => {
    const png = new Uint8Array(
      await new Jimp({ width: 60, height: 30, color: 0x00ff00ff }).getBuffer("image/png"),
    );
    const [nodes] = await drawnNodes(() =>
      renderPdf(
        Document([
          Page({ size: { width: 200, height: 200 }, margin: 30 }, [
            Padding({ top: 10, left: 15 }, Image(png, { width, height, fit: "none" })),
          ]),
        ]),
      ),
    );
    const image = nodes!.find((node) => node.type === "image");
    expect(image).toMatchObject({
      x,
      y,
      width: 60,
      height: 30,
      clip: { x: 45, y: 40, width, height },
    });
  });

  it.each(["image/png", "image/jpeg"] as const)(
    "clips %s output to the box and restores graphics state before the next sibling",
    async (mime) => {
      const bytes = new Uint8Array(
        await new Jimp({ width: 60, height: 30, color: 0x00ff00ff }).getBuffer(mime),
      );
      const pdf = await renderPdf(
        Document([
          Page({ size: { width: 200, height: 200 }, margin: 30 }, [
            Image(bytes, { width: 20, height: 10, fit: "none" }),
            Text("after"),
          ]),
        ]),
        { compress: false },
      );
      // Top-left box (30, 30, 20, 10) becomes (30, 160) on this 200pt PDF page.
      // The natural-size image is centred at (10, 20), hence PDF y = 150.
      expect(pdf).toMatch(/q\n30 160 20 10 re\s+W n\s+q\n60 0 0 30 10 150 cm\n\/IM\d+ Do\nQ\nQ\n/);
      expect(pdf).toContain("(after)");
    },
  );
});
