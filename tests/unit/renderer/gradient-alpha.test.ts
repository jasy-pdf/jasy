import { describe, it, expect } from "vitest";
import {
  Box,
  Canvas,
  Column,
  Document,
  Page,
  Svg,
  linearGradient,
  renderPdf,
} from "../../../src/lib/api/index.ts";
import { premultipliedSamples } from "../../../src/lib/utils/gradient-shading.ts";
import { Color } from "../../../src/lib/common/color.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";

// Per-stop alpha in a gradient (#96). A PDF shading has no alpha channel, so a gradient whose stops
// differ in opacity paints its color under a luminosity soft mask that carries the alpha.

const pdfOf = (child: PDFElement) =>
  renderPdf(Document([Page({ margin: 40 }, [Column([child])])]), { compress: false });

const box = (...stops: string[]) =>
  Box({ width: 100, height: 40, bg: linearGradient(...stops) }, []);

describe("a gradient's stop alpha", () => {
  it("a fade to transparent is masked, not drawn black", async () => {
    const pdf = await pdfOf(box("transparent", "blue"));
    expect(pdf).toMatch(/\/SMask << \/Type \/Mask \/S \/Luminosity \/G \d+ 0 R >>/);
    // The mask's own shading carries the alpha, 0 to 1, in gray.
    expect(pdf).toMatch(/\/ColorSpace \/DeviceGray/);
    expect(pdf).toMatch(/\/C0 \[0\.000\] \/C1 \[1\.000\]/);
  });

  it("keeps the color of the opaque stop where the other one is transparent (premultiplied, as CSS)", () => {
    const samples = premultipliedSamples([
      { offset: 0, color: new Color(0, 0, 0, 0) },
      { offset: 1, color: new Color(0, 0, 255) },
    ]);
    for (let i = 0; i < samples.length; i += 3) {
      expect([samples[i], samples[i + 1], samples[i + 2]]).toEqual([0, 0, 255]);
    }
  });

  it("weights a half-transparent stop by its alpha", () => {
    // Red at alpha 1 to blue at alpha 0.5, halfway: (255*1*0.5, 0, 255*0.5*0.5) / 0.75.
    const samples = premultipliedSamples(
      [
        { offset: 0, color: new Color(255, 0, 0) },
        { offset: 1, color: new Color(0, 0, 255, 0.5) },
      ],
      3,
    );
    expect([samples[3], samples[4], samples[5]]).toEqual([170, 0, 85]);
  });

  it("one alpha on every stop is the plain fill opacity, no mask", async () => {
    const pdf = await pdfOf(box("rgba(255,0,0,0.5)", "rgba(0,0,255,0.5)"));
    expect(pdf).not.toContain("/SMask");
    expect(pdf).toContain("/ca 0.500");
  });

  it("opaque stops write no mask and no transparency at all", async () => {
    const pdf = await pdfOf(box("red", "blue"));
    expect(pdf).not.toContain("/SMask");
    expect(pdf).not.toContain("/ExtGState");
  });

  it("a Canvas fill is masked the same way", async () => {
    const pdf = await pdfOf(
      Canvas({ width: 100, height: 40 }, (c) => {
        c.rect(0, 0, 100, 40).fill(linearGradient("blue", "transparent"));
      }),
    );
    expect(pdf).toMatch(/\/S \/Luminosity/);
  });

  it("an SVG gradient whose stops differ in stop-opacity is drawn, masked", async () => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">` +
      `<linearGradient id="g"><stop stop-color="#00f"/>` +
      `<stop offset="1" stop-color="#00f" stop-opacity="0"/></linearGradient>` +
      `<rect width="100" height="40" fill="url(#g)"/></svg>`;
    const pdf = await pdfOf(Svg(svg));
    expect(pdf).toMatch(/\/S \/Luminosity/);
  });
});
