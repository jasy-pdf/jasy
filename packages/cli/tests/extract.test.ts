import { describe, it, expect } from "vitest";
import { renderZugferd } from "@jasy/zugferd";
import { extractEmbeddedXml } from "../src/core/extract";

const invoice = {
  number: "RE-EXTRACT-1",
  issueDate: "2026-06-19",
  currency: "EUR",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "Bonn", postCode: "53113", country: "DE" } },
  lines: [
    {
      name: "Service",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
  ],
};

describe("extractEmbeddedXml", () => {
  it("round-trips the embedded XML out of a compressed ZUGFeRD PDF (writer → reader)", async () => {
    const { bytes, xml } = await renderZugferd(invoice);
    const extracted = extractEmbeddedXml(bytes);
    expect(extracted).toBe(xml); // exact round-trip
    expect(extracted).toContain("<rsm:CrossIndustryInvoice");
    expect(extracted).toContain("RE-EXTRACT-1");
  });

  it("also works with compression off", async () => {
    const { bytes, xml } = await renderZugferd(invoice, { compress: false });
    expect(extractEmbeddedXml(bytes)).toBe(xml);
  });

  it("throws a helpful error on a PDF with no embedded XML", () => {
    const plain = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
    expect(() => extractEmbeddedXml(plain)).toThrow(/ZUGFeRD|Factur-X|embedded/i);
  });

  // some tools embed their own source (e.g. a gobl.json from Invopop) ALONGSIDE the invoice XML -
  // and list it first. We must still pick the e-invoice XML, not the first embedded file.
  it("picks the invoice XML when several files are embedded (gobl.json listed first)", () => {
    const pdf = Buffer.from(
      "%PDF-1.7\n" +
        "1 0 obj\n<< /Type /Filespec /F (gobl.json) /UF (gobl.json) /EF << /F 2 0 R /UF 2 0 R >> >>\nendobj\n" +
        '2 0 obj\n<< /Type /EmbeddedFile >>\nstream\n{"gobl":true}\nendstream\nendobj\n' +
        "3 0 obj\n<< /Type /Filespec /F (xrechnung.xml) /UF (xrechnung.xml) /EF << /F 4 0 R /UF 4 0 R >> >>\nendobj\n" +
        "4 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml >>\nstream\n<rsm:CrossIndustryInvoice>OK</rsm:CrossIndustryInvoice>\nendstream\nendobj\n",
      "latin1",
    );
    const xml = extractEmbeddedXml(pdf);
    expect(xml).toContain("CrossIndustryInvoice");
    expect(xml).not.toContain("gobl");
  });
});
