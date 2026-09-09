import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { xrechnungProblems } from "../src/profile-check.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * BG-19, SEPA direct debit - three fields that CII scatters over THREE separate blocks (settlement,
 * payment means, payment terms) while UBL keeps them in two. The position tests are the point: each
 * one sits where its own XSD type puts it, and getting any of them wrong produces an invalid file
 * that the business-rule validator still waves through.
 */

const base: Invoice = {
  number: "RE-2026-400",
  issueDate: "2026-09-09",
  currency: "EUR",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "re@muster.invalid",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "A", phone: "1", email: "a@muster.invalid" },
  },
  buyer: {
    name: "Kunde AG",
    electronicAddress: "re@kunde.invalid",
    address: { city: "München", postCode: "80331", country: "DE" },
  },
  delivery: { date: "2026-09-01" },
  dueDate: "2026-09-23",
  lines: [
    {
      name: "Wartung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: {
    meansCode: "59", // SEPA direct debit
    directDebit: {
      mandateReference: "MND-2026-0042",
      creditorId: "DE98ZZZ09999999999",
      debitedIban: "DE02120300000000202051",
    },
  },
};

const computed = computeInvoice(base);

describe("CII puts the three fields in three different places", () => {
  const xml = toCII(base, computed);

  it("BT-90 as the creditor reference, FIRST in the settlement", () => {
    expect(xml).toContain("<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>");
    expect(xml.indexOf("CreditorReferenceID")).toBeLessThan(xml.indexOf("ram:PaymentReference"));
  });

  it("BT-91 as the payer account, BEFORE the payee account", () => {
    expect(xml).toContain(
      "<ram:PayerPartyDebtorFinancialAccount><ram:IBANID>DE02120300000000202051</ram:IBANID></ram:PayerPartyDebtorFinancialAccount>",
    );
  });

  it("BT-89 as the mandate, inside the payment terms", () => {
    expect(xml).toContain("<ram:DirectDebitMandateID>MND-2026-0042</ram:DirectDebitMandateID>");
    expect(xml.indexOf("SpecifiedTradePaymentTerms")).toBeLessThan(
      xml.indexOf("DirectDebitMandateID"),
    );
  });

  it("emits the payment terms even when nothing but the mandate is set", () => {
    const bare: Invoice = {
      ...base,
      dueDate: undefined,
      payment: { meansCode: "59", directDebit: { mandateReference: "M-1" } },
    };
    expect(toCII(bare, computeInvoice(bare))).toContain(
      "<ram:DirectDebitMandateID>M-1</ram:DirectDebitMandateID>",
    );
  });
});

describe("UBL keeps the mandate together and hangs the creditor id on the party", () => {
  const xml = toUBL(base, computed);

  it("BT-89 and BT-91 inside cac:PaymentMandate", () => {
    expect(xml).toContain(
      "<cac:PaymentMandate><cbc:ID>MND-2026-0042</cbc:ID><cac:PayerFinancialAccount><cbc:ID>DE02120300000000202051</cbc:ID></cac:PayerFinancialAccount></cac:PaymentMandate>",
    );
  });

  it("BT-90 on the seller party, as the FIRST child, with the SEPA scheme", () => {
    expect(xml).toContain(
      '<cac:PartyIdentification><cbc:ID schemeID="SEPA">DE98ZZZ09999999999</cbc:ID></cac:PartyIdentification>',
    );
    const party = /<cac:AccountingSupplierParty>[\s\S]*?<\/cac:AccountingSupplierParty>/.exec(
      xml,
    )![0];
    expect(party.indexOf("PartyIdentification")).toBeLessThan(party.indexOf("cac:PostalAddress"));
  });
});

describe("the paper tells the payer what is about to be collected", () => {
  const printed = (invoice: Invoice) =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");

  it("names the mandate, the creditor id and the debited account", () => {
    const text = printed(base);
    expect(text).toContain("SEPA-Lastschrift");
    expect(text).toContain("MND-2026-0042");
    expect(text).toContain("DE98ZZZ09999999999");
    expect(text).toContain("DE02120300000000202051");
  });

  it("says nothing when the invoice is paid by transfer", () => {
    const transfer: Invoice = { ...base, payment: { meansCode: "58", iban: "DE02" } };
    expect(printed(transfer)).not.toContain("SEPA-Lastschrift");
  });
});

describe("the pre-flight, including a rule that was wrong before", () => {
  it("no longer demands a payee IBAN for a direct debit (59 is not a credit transfer)", () => {
    // UNCL 4461: 58 = SEPA credit transfer, 59 = SEPA DIRECT DEBIT. 59 used to sit in the
    // credit-transfer list, so this invoice was told to supply an IBAN it does not need.
    expect(xrechnungProblems(base).join(" ")).not.toContain("BT-84");
  });

  it("still demands one for a real credit transfer", () => {
    const transfer: Invoice = { ...base, payment: { meansCode: "58" } };
    expect(xrechnungProblems(transfer).join(" ")).toContain("BT-84");
  });

  it("demands a mandate reference for a collection", () => {
    const noMandate: Invoice = { ...base, payment: { meansCode: "59" } };
    expect(xrechnungProblems(noMandate).join(" ")).toContain("BT-89");
  });

  it("does not ask for a mandate when nobody is collecting", () => {
    const transfer: Invoice = { ...base, payment: { meansCode: "58", iban: "DE02" } };
    expect(xrechnungProblems(transfer).join(" ")).not.toContain("BT-89");
  });
});

describe("absent means untouched", () => {
  it("adds nothing to either syntax", () => {
    const plain: Invoice = { ...base, payment: { meansCode: "58", iban: "DE02" } };
    const c = computeInvoice(plain);
    expect(toCII(plain, c)).not.toContain("DirectDebitMandateID");
    expect(toCII(plain, c)).not.toContain("CreditorReferenceID");
    expect(toCII(plain, c)).not.toContain("PayerPartyDebtorFinancialAccount");
    expect(toUBL(plain, c)).not.toContain("PaymentMandate");
    expect(toUBL(plain, c)).not.toContain("PartyIdentification");
  });
});
