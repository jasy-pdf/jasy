import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * BG-3, the reference that makes a credit note traceable to what it corrects.
 *
 * Both syntaxes put it in a different place and CII needs a namespace we did not previously emit, so
 * the position tests here are not pedantry: CII is sequence-bound, and a correct element in the wrong
 * slot is an invalid file that the business-rule validator still passes.
 */

const base: Invoice = {
  number: "GS-2026-004",
  issueDate: "2026-09-09",
  type: 381, // credit note - the case BG-3 exists for
  currency: "EUR",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Rückvergütung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 200,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
};

const withRefs = (refs: Invoice["precedingInvoices"]): Invoice => ({
  ...base,
  precedingInvoices: refs,
});

describe("CII", () => {
  it("names the original invoice and its date", () => {
    const invoice = withRefs([{ number: "RE-2026-0100", issueDate: "2026-08-01" }]);
    const xml = toCII(invoice, computeInvoice(invoice));
    expect(xml).toContain("<ram:IssuerAssignedID>RE-2026-0100</ram:IssuerAssignedID>");
    expect(xml).toContain('<qdt:DateTimeString format="102">20260801</qdt:DateTimeString>');
  });

  it("uses the QUALIFIED namespace for the date, and declares it", () => {
    const invoice = withRefs([{ number: "RE-1", issueDate: "2026-08-01" }]);
    const xml = toCII(invoice, computeInvoice(invoice));
    // udt would be the wrong type here - FormattedIssueDateTime is qdt:FormattedDateTimeType.
    expect(xml).toContain('xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"');
    expect(xml).not.toMatch(/<ram:FormattedIssueDateTime><udt:/);
  });

  it("places it AFTER the monetary summation, which is where the XSD puts it", () => {
    const invoice = withRefs([{ number: "RE-1" }]);
    const xml = toCII(invoice, computeInvoice(invoice));
    expect(xml.indexOf("SpecifiedTradeSettlementHeaderMonetarySummation")).toBeLessThan(
      xml.indexOf("InvoiceReferencedDocument"),
    );
  });

  it("omits the date element entirely when there is no date", () => {
    const invoice = withRefs([{ number: "RE-1" }]);
    const xml = toCII(invoice, computeInvoice(invoice));
    expect(xml).toContain("<ram:IssuerAssignedID>RE-1</ram:IssuerAssignedID>");
    expect(xml).not.toContain("FormattedIssueDateTime");
  });
});

describe("UBL", () => {
  it("wraps it as a billing reference with an ISO date", () => {
    const invoice = withRefs([{ number: "RE-2026-0100", issueDate: "2026-08-01" }]);
    const xml = toUBL(invoice, computeInvoice(invoice));
    expect(xml).toContain("<cbc:ID>RE-2026-0100</cbc:ID>");
    expect(xml).toContain("<cbc:IssueDate>2026-08-01</cbc:IssueDate>");
    expect(xml).toMatch(/<cac:BillingReference><cac:InvoiceDocumentReference>/);
  });

  it("sits between the order and the contract reference, per the InvoiceType sequence", () => {
    const invoice = {
      ...withRefs([{ number: "RE-1" }]),
      purchaseOrderRef: "PO-9",
      contractRef: "C-9",
    };
    const xml = toUBL(invoice, computeInvoice(invoice));
    expect(xml.indexOf("cac:OrderReference")).toBeLessThan(xml.indexOf("cac:BillingReference"));
    expect(xml.indexOf("cac:BillingReference")).toBeLessThan(
      xml.indexOf("cac:ContractDocumentReference"),
    );
  });
});

describe("more than one, because a correction may settle several", () => {
  it("emits every reference in both syntaxes", () => {
    const invoice = withRefs([
      { number: "RE-1", issueDate: "2026-07-01" },
      { number: "RE-2", issueDate: "2026-08-01" },
    ]);
    const computed = computeInvoice(invoice);
    expect(toCII(invoice, computed).match(/InvoiceReferencedDocument>/g)).toHaveLength(4); // 2 open + 2 close
    expect(toUBL(invoice, computed).match(/<cac:BillingReference>/g)).toHaveLength(2);
  });
});

describe("the paper names it too", () => {
  const printed = (invoice: Invoice) =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");

  it("shows the number and the date in the reference box", () => {
    const text = printed(withRefs([{ number: "RE-2026-0100", issueDate: "2026-08-01" }]));
    expect(text).toContain("Bezug auf Rechnung");
    expect(text).toContain("RE-2026-0100");
    expect(text).toContain("01.08.2026");
  });

  it("lists several on one line", () => {
    const text = printed(withRefs([{ number: "RE-1" }, { number: "RE-2" }]));
    expect(text).toMatch(/RE-1, RE-2/);
  });

  it("says nothing at all when there is no reference", () => {
    expect(printed(base)).not.toContain("Bezug auf Rechnung");
  });
});

describe("absent means untouched", () => {
  it("adds no element to either syntax", () => {
    const computed = computeInvoice(base);
    expect(toCII(base, computed)).not.toContain("InvoiceReferencedDocument");
    expect(toUBL(base, computed)).not.toContain("BillingReference");
  });
});
