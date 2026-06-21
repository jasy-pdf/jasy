import { describe, it, expect } from "vitest";
import { toCII, toUBL, computeInvoice } from "@jasy/zugferd";
import { parseCII, parseUBL, parseInvoice } from "../src/core/parse";

// a rich invoice exercising every field the CII parser handles
const invoice = {
  number: "RE-2026-014",
  issueDate: "2026-06-20",
  currency: "EUR",
  dueDate: "2026-07-04",
  buyerReference: "04011000-12345-34",
  purchaseOrderRef: "BST-9912",
  notes: ["Vielen Dank für Ihren Auftrag.", "Leistungszeitraum: Juni 2026."],
  seller: {
    name: "Muster Studio GmbH",
    tradingName: "Muster Studio",
    vatId: "DE123456789",
    taxNumber: "147/815/12345",
    legalRegistrationId: "HRB 98765",
    electronicAddress: "rechnung@muster.de",
    address: {
      line1: "Hauptstraße 1",
      line2: "Hinterhaus",
      city: "Berlin",
      postCode: "10115",
      subdivision: "Berlin",
      country: "DE",
    },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster.de" },
  },
  buyer: {
    name: "Beispiel Kunde AG",
    vatId: "DE987654321",
    electronicAddress: "einkauf@kunde.de",
    address: { line1: "Marienplatz 1", city: "München", postCode: "80331", country: "DE" },
    contact: { name: "Max Käufer", email: "einkauf@kunde.de" },
  },
  delivery: { date: "2026-06-15" },
  payeeName: "Muster Studio GmbH",
  lines: [
    {
      id: "A1",
      name: "Webdesign",
      description: "Konzept + Layout",
      quantity: 2,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
    {
      name: "Hosting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 50,
      vat: { category: "S" as const, ratePercent: 7 },
    },
  ],
  payment: {
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    accountName: "Muster Studio GmbH",
    meansText: "SEPA",
    terms: "14 Tage netto",
  },
};

const cii = (inv: typeof invoice) => toCII(inv, computeInvoice(inv));

describe("parseCII - XML → Invoice", () => {
  it("round-trips: re-emitting the parsed invoice reproduces the same CII", () => {
    const xml = cii(invoice);
    const parsed = parseCII(xml);
    expect(toCII(parsed, computeInvoice(parsed))).toBe(xml);
  });

  it("extracts the key fields", () => {
    const p = parseCII(cii(invoice));
    expect(p.number).toBe("RE-2026-014");
    expect(p.currency).toBe("EUR");
    expect(p.dueDate).toBe("2026-07-04");
    expect(p.buyerReference).toBe("04011000-12345-34");
    expect(p.seller.name).toBe("Muster Studio GmbH");
    expect(p.seller.vatId).toBe("DE123456789");
    expect(p.seller.contact?.email).toBe("kontakt@muster.de");
    expect(p.buyer.address.city).toBe("München");
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0]).toMatchObject({
      id: "A1",
      name: "Webdesign",
      quantity: 2,
      netUnitPrice: 100,
    });
    expect(p.lines[1].id).toBeUndefined(); // auto-numbered line keeps no id
    expect(p.payment?.iban).toBe("DE02120300000000202051");
  });

  it("parseInvoice dispatches by detected syntax", () => {
    expect(parseInvoice(cii(invoice)).number).toBe("RE-2026-014");
  });
});

const ubl = (inv: typeof invoice) => toUBL(inv, computeInvoice(inv));

describe("parseUBL - XML → Invoice", () => {
  it("round-trips: re-emitting the parsed invoice reproduces the same UBL", () => {
    const xml = ubl(invoice);
    const parsed = parseUBL(xml);
    expect(toUBL(parsed, computeInvoice(parsed))).toBe(xml);
  });

  it("extracts the key fields", () => {
    const p = parseUBL(ubl(invoice));
    expect(p.number).toBe("RE-2026-014");
    expect(p.currency).toBe("EUR");
    expect(p.seller.vatId).toBe("DE123456789");
    expect(p.seller.taxNumber).toBe("147/815/12345");
    expect(p.seller.contact?.email).toBe("kontakt@muster.de");
    expect(p.buyer.address.city).toBe("München");
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0]).toMatchObject({
      id: "A1",
      name: "Webdesign",
      quantity: 2,
      netUnitPrice: 100,
    });
    expect(p.payment?.iban).toBe("DE02120300000000202051");
  });

  it("parseInvoice dispatches UBL", () => {
    expect(parseInvoice(ubl(invoice)).number).toBe("RE-2026-014");
  });
});
