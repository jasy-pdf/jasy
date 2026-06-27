import { describe, it, expect } from "vitest";
import { toUBL } from "../src/ubl";
import { computeInvoice } from "../src/compute";
import { Invoice } from "../src/invoice";

const invoice: Invoice = {
  number: "RE-1",
  issueDate: "2026-06-18",
  currency: "EUR",
  dueDate: "2026-07-02",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika", phone: "+49 30 1", email: "k@muster.de" },
  },
  buyer: {
    name: "Amt",
    electronicAddress: "amt@bund.de",
    address: { line1: "Weg 5", city: "Bonn", postCode: "53113", country: "DE" },
  },
  lines: [
    {
      name: "Service",
      quantity: 2,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051" },
};

describe("toUBL", () => {
  it("emits a UBL Invoice: namespaces, EN16931 customization, line ClassifiedTaxCategory, currency", () => {
    const xml = toUBL(invoice, computeInvoice(invoice));
    expect(xml).toContain("<Invoice xmlns=");
    expect(xml).toContain("CommonAggregateComponents-2"); // cac namespace
    expect(xml).toContain("urn:cen.eu:en16931:2017</cbc:CustomizationID>"); // BT-24
    expect(xml).toContain("cac:ClassifiedTaxCategory"); // line VAT category (BR-CO-04 needs this name)
    expect(xml).toContain('currencyID="EUR"');
    expect(xml).toContain("cac:LegalMonetaryTotal");
    expect(xml).not.toContain("xrechnung");
  });

  it("switches the customization + adds the profile for the xrechnung profile", () => {
    const xml = toUBL(invoice, computeInvoice(invoice), "xrechnung");
    expect(xml).toContain("xrechnung_3.0");
    expect(xml).toContain("<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
  });
});
