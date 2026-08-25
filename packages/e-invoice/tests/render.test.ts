import { describe, it, expect } from "vitest";
import { renderZugferd } from "../src/render";
import { Invoice } from "../src/invoice";
import { toCII } from "../src/cii";
import { computeInvoice } from "../src/compute";

const invoice: Invoice = {
  number: "RE-2026-001",
  issueDate: "2026-06-17",
  currency: "EUR",
  dueDate: "2026-07-01",
  buyerReference: "04011000-12345-34",
  period: { start: "2026-06-01", end: "2026-06-30" },
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Webdesign",
      quantity: 2,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
    {
      name: "Hosting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 50,
      vat: { category: "S", ratePercent: 7 },
    },
  ],
  payment: { iban: "DE02120300000000202051", bic: "BYLADEM1001" },
};

describe("renderZugferd", () => {
  it("assembles a PDF/A-3 with embedded factur-x.xml, XMP, OutputIntent and embedded fonts", async () => {
    const { bytes, xml } = await renderZugferd(invoice);
    const pdf = Buffer.from(bytes).toString("latin1");

    // PDF/A markers
    expect(pdf.startsWith("%PDF-1.7")).toBe(true);
    expect(pdf).toMatch(/\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
    // embedded XML attachment
    expect(pdf).toContain("/Type /EmbeddedFile");
    expect(pdf).toContain("/F (factur-x.xml)");
    expect(pdf).toContain("/AFRelationship /Data");
    // Factur-X XMP
    expect(pdf).toContain("/Type /Metadata");
    expect(pdf).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(pdf).toContain("urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#");
    expect(pdf).toContain("EN 16931");
    // OutputIntent (sRGB)
    expect(pdf).toContain("/Type /OutputIntent");
    expect(pdf).toContain("/S /GTS_PDFA1");
    // text is set in an embedded (Liberation) font, not the non-embeddable standard-14
    expect(pdf).toContain("/Subtype /CIDFontType2");

    // the returned XML is the EN16931 CII we embedded
    expect(xml).toContain("<rsm:CrossIndustryInvoice");
    expect(xml).toContain("urn:cen.eu:en16931:2017");
  });

  it("carries the service period into the XML, structured - not as a note", () => {
    // The sample above sets `period`, so this runs on every build. It is here rather than only in
    // period.test.ts because the failure mode it guards is a whole-pipeline one: the four SumUp
    // invoices that prompted BG-14 passed every validator while saying the period in prose only.
    // The PRINTED half is checked in period.test.ts - it cannot be read back out of the PDF, whose
    // text is drawn with a subsetted Identity-H font.
    expect(toCII(invoice, computeInvoice(invoice), "en16931")).toMatch(
      /BillingSpecifiedPeriod>[\s\S]*?20260601[\s\S]*?20260630/,
    );
    expect(invoice.notes ?? []).not.toContainEqual(expect.stringMatching(/Zeitraum|period/i));
  });
});
