import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";

const doc = Document([Page([Text("hi")])]);

describe("PDF/A markers (version + /ID)", () => {
  it("defaults to %PDF-1.4 and no trailer /ID (byte-safe path)", async () => {
    const pdf = await renderPdf(doc);
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf).not.toContain("/ID [");
  });

  it("bumps the header version and writes a deterministic /ID", async () => {
    const pdf = await renderPdf(doc, { pdfVersion: "1.7", documentId: true });
    expect(pdf.startsWith("%PDF-1.7\n")).toBe(true);
    expect(pdf).toMatch(/\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
  });

  it("the /ID is stable for the same input", async () => {
    const a = await renderPdf(doc, { documentId: true });
    const b = await renderPdf(doc, { documentId: true });
    const idOf = (s: string) => s.match(/\/ID \[<([0-9A-F]{32})>/)?.[1];
    expect(idOf(a)).toBe(idOf(b));
  });
});
