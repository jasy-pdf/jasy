import { describe, it, expect } from "vitest";
import { toCII, toUBL, computeInvoice } from "@jasy/zugferd";
import { detectInvoice, describeInvoice } from "../src/core/detect";

const invoice = {
  number: "RE-1",
  issueDate: "2026-06-19",
  currency: "EUR",
  seller: {
    name: "M GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "K AG", address: { city: "Bonn", postCode: "53113", country: "DE" } },
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
const c = computeInvoice(invoice);

describe("detectInvoice", () => {
  it("identifies CII / EN16931", () => {
    expect(detectInvoice(toCII(invoice, c))).toMatchObject({ syntax: "CII", profile: "en16931" });
  });
  it("identifies CII / XRechnung", () => {
    expect(detectInvoice(toCII(invoice, c, "xrechnung"))).toMatchObject({
      syntax: "CII",
      profile: "xrechnung",
    });
  });
  it("identifies UBL / EN16931", () => {
    expect(detectInvoice(toUBL(invoice, c))).toMatchObject({ syntax: "UBL", profile: "en16931" });
  });
  it("identifies UBL / XRechnung and describes it", () => {
    const meta = detectInvoice(toUBL(invoice, c, "xrechnung"));
    expect(meta).toMatchObject({ syntax: "UBL", profile: "xrechnung" });
    expect(describeInvoice(meta)).toContain("XRechnung");
  });
});
