import { describe, it, expect } from "vitest";
import { toCII } from "../src/cii";
import { toUBL } from "../src/ubl";
import { computeInvoice } from "../src/compute";
import { xrechnungProblems } from "../src/profile-check";
import { Invoice } from "../src/invoice";
import { defaultInvoiceTemplate } from "../src/template";
import { resolveLabels, makeFormatters } from "../src/i18n";

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

describe("the period in the PRINTED invoice", () => {
  // The point of BG-14 is that both halves of a ZUGFeRD file say the same thing. A period that lives
  // only in the XML is the same defect as one that lives only in the text, just mirrored - which is
  // exactly how the four rejected invoices that prompted this failed.
  const printed = (i: Invoice, locale: "de" | "en" = "de"): string[] => {
    const doc = defaultInvoiceTemplate(
      i,
      computeInvoice(i),
      resolveLabels(locale),
      makeFormatters(locale, i.currency),
    );
    const out: string[] = [];
    const seen = new Set<unknown>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      const props = (node as { getProps?: () => { content?: unknown } }).getProps?.();
      if (typeof props?.content === "string") out.push(props.content);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    };
    walk(doc);
    return out;
  };

  it("shows the period, labelled, on the document", () => {
    const text = printed({ ...base, period });
    expect(text).toContain("Leistungszeitraum");
    expect(text).toContain("Mai 2026"); // a whole calendar month collapses to its name
  });

  it("shows both ends when the period is not a whole month", () => {
    const text = printed({ ...base, period: { start: "2026-05-03", end: "2026-06-14" } });
    expect(text).toContain("03.05.2026 - 14.06.2026");
  });

  it("says nothing at all when there is no period", () => {
    expect(printed(base)).not.toContain("Leistungszeitraum");
  });

  it("shows a delivery date and a period side by side, since the XML carries both", () => {
    const text = printed({ ...base, period, delivery: { date: "2026-05-31" } });
    expect(text).toContain("Leistungszeitraum");
    expect(text).toContain("Lieferdatum");
  });

  it("follows the locale", () => {
    const text = printed({ ...base, period }, "en");
    expect(text).toContain("Service period");
    expect(text).toContain("May 2026");
  });
});

describe("the line period on the paper (BG-26)", () => {
  // The document period was printed since 2026-08-25; a period on a single LINE reached the XML and
  // stayed invisible. That is the half-a-document defect one level down - the case it matters for is
  // an invoice whose lines cover DIFFERENT months, where the header period cannot speak for them.
  const printed = (i: Invoice): string[] => {
    const doc = defaultInvoiceTemplate(
      i,
      computeInvoice(i),
      resolveLabels("de"),
      makeFormatters("de", i.currency),
    );
    const out: string[] = [];
    const seen = new Set<unknown>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      const props = (node as { getProps?: () => { content?: unknown } }).getProps?.();
      if (typeof props?.content === "string") out.push(props.content);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    };
    walk(doc);
    return out;
  };

  const twoMonths: Invoice = {
    ...base,
    lines: [
      { ...base.lines[0], name: "Mai", period: { start: "2026-05-01", end: "2026-05-31" } },
      { ...base.lines[0], name: "Juni", period: { start: "2026-06-01", end: "2026-06-30" } },
    ],
  };

  it("prints each line's own period", () => {
    const text = printed(twoMonths).join("\n");
    expect(text).toContain("Leistungszeitraum Mai 2026");
    expect(text).toContain("Leistungszeitraum Juni 2026");
  });

  it("stays silent when the line repeats the document period", () => {
    // Same span on the header and on every row is noise; the header already said it.
    const same: Invoice = { ...base, period, lines: [{ ...base.lines[0], period }] };
    const rows = printed(same).filter((t) => t.startsWith("Leistungszeitraum "));
    expect(rows).toEqual([]); // the header uses a separate label/value pair, not this string
  });

  it("still prints a line period when the document has none", () => {
    const lineOnly: Invoice = { ...base, lines: [{ ...base.lines[0], period }] };
    expect(printed(lineOnly).join("\n")).toContain("Leistungszeitraum Mai 2026");
  });
});
