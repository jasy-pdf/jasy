import { describe, it, expect } from "vitest";
import {
  decodePdfText,
  encodePdfText,
  isPlainPdfText,
} from "../../../src/lib/text/pdf-text-string.ts";
import { Document, Page, Text, Bookmark, Link, renderToBytes } from "../../../src/lib/api/index.ts";
import { PdfDocument } from "../../../src/lib/edit/document.ts";
import { get, isDict, isString } from "../../../src/lib/edit/objects.ts";

// A PDF text string is PDFDocEncoding or UTF-16BE - NOT Windows-1252, which is what the page encoder
// speaks. Byte 0x96 is an en dash in Windows-1252 and "Œ" in PDFDocEncoding; 0x80 is "€" there and "•" here.

describe("one table, both directions", () => {
  it("writes PDFDocEncoding where it can say everything", () => {
    expect([...encodePdfText("Preis – 5 €")]).toEqual([
      ...new TextEncoder().encode("Preis "),
      0x85, // en dash
      ...new TextEncoder().encode(" 5 "),
      0xa0, // euro sign
    ]);
    expect(decodePdfText(encodePdfText("Preis – 5 €"))).toBe("Preis – 5 €");
  });

  it("falls back to UTF-16BE with its BOM for anything else", () => {
    const bytes = encodePdfText("→ 日本 😀");
    expect([bytes[0], bytes[1]]).toEqual([0xfe, 0xff]);
    expect(decodePdfText(bytes)).toBe("→ 日本 😀");
  });

  it("reads UTF-8 with its BOM (PDF 2.0)", () => {
    expect(decodePdfText(Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode("ü→")))).toBe(
      "ü→",
    );
  });

  it("knows which text stays a plain literal", () => {
    expect(isPlainPdfText("Rechnung für Müller")).toBe(true);
    expect(isPlainPdfText("Preis – 5")).toBe(false);
    expect(isPlainPdfText("a b")).toBe(false); // 0xA0 is the euro sign in PDFDocEncoding
  });
});

describe("what the writer emits", () => {
  it("a bookmark title reads back as written", async () => {
    const title = "Preis – 5 € → ok";
    const bytes = await renderToBytes(Document([Page([Bookmark({ title }, Text("x"))])]), {
      compress: false,
    });
    const doc = await PdfDocument.open(bytes);
    const titles = doc
      .objectNumbers()
      .map((n) => doc.getObject(n))
      .filter(isDict)
      .map((o) => get(o, "Title"))
      .map((t) => (isString(t) ? decodePdfText(t.bytes) : undefined))
      .filter((t) => t !== undefined);
    expect(titles).toContain(title);
  });

  it("a plain title stays a readable literal - existing documents keep their bytes", async () => {
    const bytes = await renderToBytes(
      Document([Page([Bookmark({ title: "Rechnung für Müller" }, Text("x"))])]),
      { compress: false },
    );
    expect(new TextDecoder("latin1").decode(bytes)).toContain("/Title (Rechnung für Müller)");
  });

  it("a link to a non-ASCII address is percent-encoded, as a browser writes it", async () => {
    const bytes = await renderToBytes(
      Document([Page([Link({ href: "https://x.example/straße" }, Text("x"))])]),
      { compress: false },
    );
    expect(new TextDecoder("latin1").decode(bytes)).toContain(
      "/URI (https://x.example/stra%C3%9Fe)",
    );
  });
});
