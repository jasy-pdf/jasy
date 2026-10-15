import { describe, it, expect } from "vitest";
import { renderZugferd, toCII, toUBL, computeInvoice } from "@jasy/e-invoice";
import type { Invoice } from "@jasy/e-invoice";
import { hardInvoice } from "../../e-invoice/tests/support/hard-numbers.ts";
import { validateInvoiceXml, profileFor } from "../src/core/validate";

// a fully XRechnung-ready invoice (Leitweg-ID, seller contact + e-address, buyer e-address, IBAN …)
const xrechnung = {
  number: "RE-X-1",
  issueDate: "2026-06-20",
  currency: "EUR",
  dueDate: "2026-07-04",
  buyerReference: "04011000-12345-34", // Leitweg-ID (BT-10)
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstraße 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster.de" },
  },
  buyer: {
    name: "Behörde XY",
    electronicAddress: "einkauf@behoerde.de",
    address: { line1: "Amtsplatz 1", city: "Bonn", postCode: "53113", country: "DE" },
  },
  delivery: { date: "2026-06-19" },
  lines: [
    {
      id: "1",
      name: "Leistung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051", terms: "Zahlbar innerhalb 14 Tagen netto." },
};

describe("XRechnung validation (EN 16931 + BR-DE delta)", () => {
  it("a conformant XRechnung passes both rule sets", async () => {
    const { xml } = await renderZugferd(xrechnung, { profile: "xrechnung" });
    const report = validateInvoiceXml(xml, "xrechnung-cii");
    expect(report.errors).toHaveLength(0);
    expect(report.valid).toBe(true);
  });

  it("flags a missing Leitweg-ID with a BR-DE rule", async () => {
    const { xml } = await renderZugferd(xrechnung, { profile: "xrechnung" });
    const broken = xml.replace(/<ram:BuyerReference>[\s\S]*?<\/ram:BuyerReference>/, "");
    expect(broken).not.toBe(xml);
    const report = validateInvoiceXml(broken, "xrechnung-cii");
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.id?.startsWith("BR-DE"))).toBe(true);
  });

  it("profileFor picks the right rule set per syntax + CIUS", () => {
    expect(profileFor({ syntax: "CII", profile: "xrechnung", guideline: null })).toBe(
      "xrechnung-cii",
    );
    expect(profileFor({ syntax: "UBL", profile: "xrechnung", guideline: null })).toBe(
      "xrechnung-ubl",
    );
    expect(profileFor({ syntax: "UBL", profile: "en16931", guideline: null })).toBe("en16931-ubl");
    expect(profileFor({ syntax: "CII", profile: "en16931", guideline: null })).toBe("en16931-cii");
  });
});

/**
 * Both syntaxes through the official rules, not only CII - a UBL-only rule (PEPPOL-EN16931-R101 on a
 * line's object reference) once rejected every UBL XRechnung that used it, and nothing here ran UBL.
 */
describe("what we write passes the official rules in both syntaxes", () => {
  const rich: Invoice = {
    ...hardInvoice,
    lines: hardInvoice.lines.map((l, i) => (i === 0 ? { ...l, objectRef: "OBJ-7" } : l)),
    supportingDocuments: [{ reference: "TS-1", url: "https://example.com/timesheet.pdf" }],
    paidAmount: 10,
  };
  const c = computeInvoice(rich);

  it.each([
    ["EN 16931, CII", () => toCII(rich, c, "en16931"), "en16931-cii"],
    ["EN 16931, UBL", () => toUBL(rich, c, "en16931"), "en16931-ubl"],
    ["XRechnung, CII", () => toCII(rich, c, "xrechnung"), "xrechnung-cii"],
    ["XRechnung, UBL", () => toUBL(rich, c, "xrechnung"), "xrechnung-ubl"],
  ] as const)("%s", (_what, write, profile) => {
    expect(validateInvoiceXml(write(), profile).errors).toEqual([]);
  });

  it("the UBL rule is really applied: without type code 130 R101 rejects the line reference", () => {
    const broken = toUBL(rich, c, "xrechnung").replace(
      "<cbc:DocumentTypeCode>130</cbc:DocumentTypeCode></cac:DocumentReference>",
      "</cac:DocumentReference>",
    );
    const report = validateInvoiceXml(broken, "xrechnung-ubl");
    const r101 = report.errors.find((e) => e.id === "PEPPOL-EN16931-R101");
    expect(r101).toBeDefined();
    // The id is carried once, in `id` - not repeated in front of the message.
    expect(r101!.text).toMatch(/^Element Document reference/);
  });
});
