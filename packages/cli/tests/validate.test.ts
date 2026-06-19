import { describe, it, expect } from "vitest";
import { renderZugferd } from "@jasy/zugferd";
import { extractEmbeddedXml } from "../src/core/extract";
import { validateInvoiceXml } from "../src/core/validate";

// a complete, conformant invoice (mirrors the sample renderer — known EN16931-valid)
const invoice = {
  number: "RE-2026-VAL",
  issueDate: "2026-06-19",
  currency: "EUR",
  dueDate: "2026-07-03",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster Studio GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster-studio.de",
    address: { line1: "Hauptstraße 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster-studio.de" },
  },
  buyer: {
    name: "Beispiel Kunde AG",
    address: { line1: "Marienplatz 1", city: "München", postCode: "80331", country: "DE" },
  },
  lines: [
    {
      id: "1",
      name: "Webdesign",
      quantity: 2,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
    {
      id: "2",
      name: "Hosting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 50,
      vat: { category: "S" as const, ratePercent: 7 },
    },
  ],
  payment: { iban: "DE02120300000000202051", terms: "Zahlbar innerhalb 14 Tagen netto." },
};

describe("validateInvoiceXml — EN16931 CII (saxon-js, local)", () => {
  it("passes a conformant ZUGFeRD invoice (0 errors)", async () => {
    const { bytes } = await renderZugferd(invoice);
    const report = validateInvoiceXml(extractEmbeddedXml(bytes), "en16931-cii");
    expect(report.errors).toHaveLength(0);
    expect(report.valid).toBe(true);
  });

  it("flags a corrupted grand total (BR-CO total-consistency rule fires)", async () => {
    const { xml } = await renderZugferd(invoice);
    const broken = xml.replace(
      /(<ram:GrandTotalAmount>)[\d.]+(<\/ram:GrandTotalAmount>)/,
      "$1999999.99$2",
    );
    expect(broken).not.toBe(xml); // make sure the corruption actually applied
    const report = validateInvoiceXml(broken, "en16931-cii");
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });
});
