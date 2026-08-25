import { describe, it, expect } from "vitest";
import { toCII, toUBL, computeInvoice } from "@jasy/e-invoice";
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
    additionalLegalInfo: "Geschäftsführer: Erika Muster", // BT-33
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
      allowancesCharges: [
        {
          isCharge: false,
          amount: 10,
          vat: { category: "S" as const, ratePercent: 19 },
          reason: "Treuerabatt",
        },
      ],
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
    meansText: 'SEPA "instant" & Giro <sofort>',
    reference: "VZ-2026-014", // BT-83
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

// a reverse-charge invoice with a document discount + a surcharge - exercises BG-20/21 + BT-120/121
const acInvoice = {
  number: "RE-AC-1",
  issueDate: "2026-06-21",
  currency: "EUR",
  seller: {
    name: "Bau GmbH",
    vatId: "DE111111111",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "Bonn", postCode: "53113", country: "DE" } },
  lines: [
    {
      name: "Bauleistung",
      quantity: 10,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "AE" as const, ratePercent: 0 },
    },
  ],
  allowancesCharges: [
    {
      isCharge: false,
      amount: 50,
      vat: { category: "AE" as const, ratePercent: 0 },
      reason: "Treuerabatt",
    },
    {
      isCharge: true,
      amount: 20,
      vat: { category: "AE" as const, ratePercent: 0 },
      reason: "Versand",
    },
  ],
  vatExemptionReasons: {
    AE: { text: "Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)", code: "VATEX-EU-AE" },
  },
};

describe("parse - allowances/charges + VAT exemptions (BG-20/21, BT-120/121)", () => {
  it("CII round-trips a discount, a surcharge and the reverse-charge reason", () => {
    const xml = toCII(acInvoice, computeInvoice(acInvoice));
    const p = parseCII(xml);
    expect(toCII(p, computeInvoice(p))).toBe(xml);
    expect(p.allowancesCharges).toHaveLength(2);
    expect(p.vatExemptionReasons?.AE?.code).toBe("VATEX-EU-AE");
  });

  it("UBL round-trips the same", () => {
    const xml = toUBL(acInvoice, computeInvoice(acInvoice));
    const p = parseUBL(xml);
    expect(toUBL(p, computeInvoice(p))).toBe(xml);
    expect(p.allowancesCharges).toHaveLength(2);
    expect(p.vatExemptionReasons?.AE?.code).toBe("VATEX-EU-AE");
  });
});

describe("free text that would break the XML", () => {
  // BT-82 rides in an ATTRIBUTE, where a double quote ends the value early - and `esc` handled only
  // & < >. Element text and attribute text must survive the same characters, in both directions.
  const nasty = 'SEPA "instant" & Giro <sofort>';

  it("survives a CII round-trip", () => {
    const invoice2 = { ...invoice, payment: { ...invoice.payment, meansText: nasty } };
    expect(parseCII(cii(invoice2)).payment?.meansText).toBe(nasty);
  });

  it("survives a UBL round-trip, where it is an attribute", () => {
    const invoice2 = { ...invoice, payment: { ...invoice.payment, meansText: nasty } };
    const xml = ubl(invoice2);
    expect(xml).toContain('name="SEPA &quot;instant&quot; &amp; Giro &lt;sofort&gt;"');
    expect(parseUBL(xml).payment?.meansText).toBe(nasty);
  });

  it("keeps a standalone payment reference, with no means and no terms", () => {
    // BT-83 is emitted on its own; a reader that only builds `payment` from means/terms drops it.
    // Built from scratch, NOT spread from `invoice`: its dueDate alone produces PaymentTerms, which
    // would make the condition true anyway and the test pass for the wrong reason.
    const bare = {
      number: "RE-BARE",
      issueDate: "2026-08-25",
      currency: "EUR",
      seller: { name: "S", address: { country: "DE" as const } },
      buyer: { name: "K", address: { country: "DE" as const } },
      lines: [
        {
          name: "L",
          quantity: 1,
          unit: "C62",
          netUnitPrice: 1,
          vat: { category: "S" as const, ratePercent: 19 },
        },
      ],
      payment: { reference: "VZ-ALLEIN" },
    };
    const xml = cii(bare);
    expect(xml).not.toContain("SpecifiedTradeSettlementPaymentMeans");
    expect(xml).not.toContain("SpecifiedTradePaymentTerms");
    expect(parseCII(xml).payment?.reference).toBe("VZ-ALLEIN");
  });
});
