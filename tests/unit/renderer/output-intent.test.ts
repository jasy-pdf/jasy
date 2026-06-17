import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";

const doc = Document([Page([Text("hi")])]);

describe("PDF/A OutputIntent", () => {
  it("adds no OutputIntent when none is set", async () => {
    const pdf = await renderPdf(doc);
    expect(pdf).not.toContain("/OutputIntent");
  });

  it("embeds the ICC profile and references it from a /OutputIntent", async () => {
    const icc = Buffer.alloc(64, 7); // stand-in profile bytes (the mechanism just embeds them)
    const pdf = await renderPdf(doc, { outputIntent: icc });
    expect(pdf).toContain("/Type /OutputIntent");
    expect(pdf).toContain("/S /GTS_PDFA1");
    expect(pdf).toContain("/DestOutputProfile");
    expect(pdf).toContain("/N 3"); // RGB ICC stream
    expect(pdf).toContain("/OutputIntents ["); // catalog reference
  });
});
