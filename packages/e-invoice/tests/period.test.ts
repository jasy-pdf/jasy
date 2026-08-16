import { describe, it, expect } from "vitest";
import { toCII } from "../src/cii";
import { toUBL } from "../src/ubl";
import { computeInvoice } from "../src/compute";
import { xrechnungProblems } from "../src/profile-check";
import { Invoice } from "../src/invoice";

// BG-14 (document) and BG-26 (line): the "Leistungszeitraum". German VAT law (§14 Abs. 4 Nr. 6 UStG)
// wants a delivery DATE or a PERIOD, and for a recurring service the period is the truthful one - a
// monthly maintenance fee is not delivered on one day.

const base: Invoice = {
  number: "RE-1",
  issueDate: "2026-08-06",
  currency: "EUR",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "re@muster.de",
    contact: { name: "Erika Muster", phone: "+49 1", email: "e@muster.de" },
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: {
    name: "Kunde AG",
    electronicAddress: "re@kunde.de",
    address: { city: "München", postCode: "80331", country: "DE" },
  },
  lines: [
    {
      name: "Wartung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 500,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051" },
  dueDate: "2026-08-20",
};

const period = { start: "2026-05-01", end: "2026-05-31" } as const;
const cii = (i: Invoice) => toCII(i, computeInvoice(i), "xrechnung");
const ubl = (i: Invoice) => toUBL(i, computeInvoice(i), "xrechnung");

describe("the document period (BG-14)", () => {
  it("writes both ends into the CII settlement", () => {
    const xml = cii({ ...base, period });
    expect(xml).toContain("<ram:BillingSpecifiedPeriod>");
    expect(xml).toMatch(/BillingSpecifiedPeriod>[\s\S]*?20260501[\s\S]*?20260531/);
  });

  it("writes them into UBL as cac:InvoicePeriod", () => {
    const xml = ubl({ ...base, period });
    expect(xml).toContain("<cbc:StartDate>2026-05-01</cbc:StartDate>");
    expect(xml).toContain("<cbc:EndDate>2026-05-31</cbc:EndDate>");
  });

  it("emits nothing at all when no period is given", () => {
    expect(cii(base)).not.toContain("BillingSpecifiedPeriod");
    expect(ubl(base)).not.toContain("InvoicePeriod");
  });
});

describe("the line period (BG-26)", () => {
  const withLine: Invoice = { ...base, lines: [{ ...base.lines[0], period }] };

  it("sits inside the LINE settlement, not the document one", () => {
    const xml = cii(withLine);
    const line = xml.slice(
      xml.indexOf("<ram:IncludedSupplyChainTradeLineItem>"),
      xml.indexOf("</ram:IncludedSupplyChainTradeLineItem>"),
    );
    expect(line).toContain("<ram:BillingSpecifiedPeriod>");
    // The document settlement stays clean - the period belongs to that one line.
    expect(xml.slice(xml.indexOf("<ram:ApplicableHeaderTradeSettlement>"))).not.toContain(
      "BillingSpecifiedPeriod",
    );
  });

  it("does the same in UBL", () => {
    const xml = ubl(withLine);
    const line = xml.slice(xml.indexOf("<cac:InvoiceLine>"), xml.indexOf("</cac:InvoiceLine>"));
    expect(line).toContain("<cac:InvoicePeriod>");
  });
});

describe("the pre-check", () => {
  it("asks for a date or a period, because the law does", () => {
    expect(xrechnungProblems(base).join(" ")).toMatch(/delivery date or a service period/);
  });

  it("is satisfied by a document period", () => {
    expect(xrechnungProblems({ ...base, period })).toEqual([]);
  });

  it("is satisfied by a delivery date", () => {
    expect(xrechnungProblems({ ...base, delivery: { date: "2026-05-31" } })).toEqual([]);
  });

  it("needs the period on EVERY line, not just one", () => {
    // The XRechnung rule says `every $line satisfies ...`; one line out of two is not enough.
    const two = { ...base, lines: [{ ...base.lines[0], period }, { ...base.lines[0] }] };
    expect(xrechnungProblems(two).join(" ")).toMatch(/delivery date or a service period/);

    const both = { ...base, lines: two.lines.map((l) => ({ ...l, period })) };
    expect(xrechnungProblems(both)).toEqual([]);
  });

  it("catches a period that runs backwards", () => {
    const back = { ...base, period: { start: "2026-05-31", end: "2026-05-01" } };
    expect(xrechnungProblems(back).join(" ")).toMatch(/ends before it starts/);
  });

  it("names the LINE when that is the one running backwards", () => {
    const back = {
      ...base,
      lines: [{ ...base.lines[0], period: { start: "2026-05-31", end: "2026-05-01" } }],
    };
    expect(xrechnungProblems(back).join(" ")).toMatch(/lines\[0\]\.period \(BG-26\)/);
  });
});
