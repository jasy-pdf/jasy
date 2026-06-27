import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";

// Regression: a Tj literal may carry a CP1252 char whose codepoint is > 0xFF ("…", "—", "€").
// The content stream must emit the Windows-1252 byte, not a latin1 low-byte cast (which turned
// "…" U+2026 into 0x26 = "&"). See PDFObjectManager.addContentStream.
describe("CP1252 special chars in a content stream", () => {
  it("emits the Windows-1252 byte for … (0x85), not the low-byte cast (&)", async () => {
    const doc = Document([Page({ size: "A4" }, [Text("dots …", { size: 12 })])]);
    const pdf = await renderPdf(doc, { compress: false }); // uncompressed -> greppable stream

    expect(pdf).toContain(String.fromCharCode(0x85)); // ellipsis -> WinAnsi 0x85
    expect(pdf).not.toContain("…"); // the raw U+2026 must not survive
    expect(pdf).not.toContain("dots &"); // and must NOT have become "&"
  });

  it("lays a run of CP1252 punctuation out without throwing (metrics resolve via AGL)", async () => {
    const doc = Document([Page({ size: "A4" }, [Text("… – — € • ™ “ ” ‘ ’ „ Š œ", { size: 12 })])]);
    await expect(renderPdf(doc)).resolves.toBeTruthy();
  });
});
