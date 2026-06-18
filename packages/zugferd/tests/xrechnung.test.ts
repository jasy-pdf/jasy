import { describe, it, expect } from "vitest";
import { toCII } from "../src/cii";
import { computeInvoice } from "../src/compute";
import { xrechnungProblems } from "../src/profile-check";
import { Invoice } from "../src/invoice";

const complete: Invoice = {
  number: "RE-1",
  issueDate: "2026-06-18",
  currency: "EUR",
  dueDate: "2026-07-02",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 123", email: "kontakt@muster.de" },
  },
  buyer: {
    name: "Amt",
    electronicAddress: "amt@bund.de",
    address: { city: "Bonn", postCode: "53113", country: "DE" },
  },
  lines: [{ name: "Service", quantity: 1, unit: "C62", netUnitPrice: 100, vat: { category: "S", ratePercent: 19 } }],
  payment: { iban: "DE02120300000000202051" },
};

describe("XRechnung profile", () => {
  it("emits the XRechnung guideline id + business process only for the xrechnung profile", () => {
    const xr = toCII(complete, computeInvoice(complete), "xrechnung");
    expect(xr).toContain("xrechnung_3.0");
    expect(xr).toContain("urn:fdc:peppol.eu:2017:poacc:billing:01:1.0"); // BT-23 business process

    const en = toCII(complete, computeInvoice(complete), "en16931");
    expect(en).toContain("urn:cen.eu:en16931:2017</ram:ID>"); // plain EN16931 guideline
    expect(en).not.toContain("xrechnung_3.0");
    expect(en).not.toContain("BusinessProcess");
  });

  it("pre-check passes a complete invoice, flags the missing B2G fields with guidance", () => {
    expect(xrechnungProblems(complete)).toEqual([]);

    const incomplete: Invoice = {
      ...complete,
      buyerReference: undefined,
      buyer: { ...complete.buyer, electronicAddress: undefined },
      seller: { ...complete.seller, contact: { name: "Erika Muster" } }, // no phone/email
    };
    const problems = xrechnungProblems(incomplete);
    expect(problems.some((p) => p.includes("Leitweg-ID"))).toBe(true);
    expect(problems.some((p) => p.includes("BT-49"))).toBe(true);
    expect(problems.some((p) => p.includes("BT-42"))).toBe(true);
    expect(problems.some((p) => p.includes("BT-43"))).toBe(true);
  });
});
