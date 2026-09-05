import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { Document, Page, Text } from "../../../src/lib/api/index.ts";
import { renderToBytes } from "../../../src/lib/api/structure.ts";

// The container has to be unwrapped where the caller actually hands a font over, not just in a unit
// test of the decoder. A WOFF2 must produce the same PAGE as the .ttf it was made from - the bytes
// differ (WOFF2 restores geometry, not the original glyph ENCODING), the drawing does not.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../fixtures/fonts/${name}`, import.meta.url))),
  );

const page = () =>
  Document({ font: "Test", size: 16 }, [
    Page({ size: "A4", margin: 40 }, [Text("Waffel fjord VAV 0123")]),
  ]);

describe("a WOFF2 registered like any other font", () => {
  it("draws exactly what the .ttf draws", async () => {
    const fromTtf = await renderToBytes(page(), {
      fonts: { Test: fixture("dejavu-subset.ttf") },
      compress: false,
    });
    const fromWoff2 = await renderToBytes(page(), {
      fonts: { Test: fixture("dejavu-subset.woff2") },
      compress: false,
    });

    const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
    // The show operator carries the glyph ids: same ids at the same positions means the same picture.
    const show = (pdf: string) => pdf.match(/<[0-9A-F]+>\s*Tj|\[[^\]]*\]\s*TJ/g);
    expect(show(text(fromWoff2))).toEqual(show(text(fromTtf)));
    expect(show(text(fromTtf))?.length).toBeGreaterThan(0);
  });

  it("works inside a styled family too", async () => {
    const pdf = await renderToBytes(page(), {
      fonts: { Test: { normal: fixture("dejavu-subset.woff2") } },
      compress: false,
    });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
