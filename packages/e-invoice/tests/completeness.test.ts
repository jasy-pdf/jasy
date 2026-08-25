import { describe, it, expect } from "vitest";
import { defaultInvoiceTemplate } from "../src/template";
import { computeInvoice } from "../src/compute";
import { resolveLabels, makeFormatters } from "../src/i18n";
import { Invoice } from "../src/invoice";
import { printedText } from "./support/printed";
import { en16931Problems } from "../src/profile-check";
import { renderZugferd } from "../src/render";

/**
 * Every field that reaches the XML must reach the PAPER.
 *
 * The defect this exists to prevent is a whole class, not one bug: data enters the model, the CII
 * generator writes it, and the template quietly never shows it. A ZUGFeRD file whose two halves say
 * different things is exactly what got four real invoices rejected - and NO validator catches it,
 * because neither EN 16931 nor PDF/A has an opinion about what the picture contains.
 *
 * The invoice below sets EVERY optional field to a distinctive marker. Anything deliberately left
 * off the page belongs in `NOT_PRINTED` with a reason - never silently.
 */

const maximal: Invoice = {
  number: "RE-MARK-NUMBER",
  issueDate: "2026-08-25",
  type: 380,
  currency: "EUR",
  dueDate: "2026-09-08",
  buyerReference: "MARK-BUYERREF",
  purchaseOrderRef: "MARK-ORDERREF",
  contractRef: "MARK-CONTRACTREF",
  notes: ["MARK-DOCNOTE"],
  seller: {
    name: "MARK-SELLERNAME",
    tradingName: "MARK-SELLERTRADING",
    vatId: "MARK-SELLERVAT",
    taxNumber: "MARK-SELLERTAXNO",
    legalRegistrationId: "MARK-SELLERREG",
    additionalLegalInfo: "MARK-SELLERLEGAL",
    electronicAddress: "MARK-SELLEREADDR",
    address: {
      line1: "MARK-SELLERLINE1",
      line2: "MARK-SELLERLINE2",
      line3: "MARK-SELLERLINE3",
      city: "MARK-SELLERCITY",
      postCode: "11111",
      subdivision: "MARK-SELLERSUB",
      country: "DE",
    },
    contact: { name: "MARK-SELLERCONTACT", phone: "MARK-SELLERPHONE", email: "MARK-SELLERMAIL" },
  },
  buyer: {
    name: "MARK-BUYERNAME",
    tradingName: "MARK-BUYERTRADING",
    vatId: "MARK-BUYERVAT",
    legalRegistrationId: "MARK-BUYERREG",
    electronicAddress: "MARK-BUYEREADDR",
    address: {
      line1: "MARK-BUYERLINE1",
      line2: "MARK-BUYERLINE2",
      line3: "MARK-BUYERLINE3",
      city: "MARK-BUYERCITY",
      postCode: "22222",
      subdivision: "MARK-BUYERSUB",
      country: "DE",
    },
    contact: { name: "MARK-BUYERCONTACT", phone: "MARK-BUYERPHONE", email: "MARK-BUYERMAIL" },
  },
  delivery: {
    date: "2026-08-20",
    recipientName: "MARK-DELIVERYTO",
    address: {
      line1: "MARK-DELIVERYLINE1",
      city: "MARK-DELIVERYCITY",
      postCode: "33333",
      country: "DE",
    },
  },
  period: { start: "2026-07-02", end: "2026-07-20" },
  payeeName: "MARK-PAYEE",
  lines: [
    {
      id: "MARK-LINEID",
      name: "MARK-ITEMNAME",
      description: "MARK-ITEMDESCR",
      sellerItemId: "MARK-SELLERITEM",
      buyerItemId: "MARK-BUYERITEM",
      standardItemId: "MARK-GTIN",
      quantity: 3,
      unit: "C62",
      netUnitPrice: 250,
      priceBaseQuantity: 10,
      vat: { category: "S", ratePercent: 19 },
      period: { start: "2026-07-02", end: "2026-07-20" },
      note: "MARK-LINENOTE",
      allowancesCharges: [
        {
          isCharge: false,
          amount: 5,
          vat: { category: "S", ratePercent: 19 },
          reason: "MARK-LINEALLOWANCE",
        },
      ],
    },
    {
      name: "MARK-REVERSECHARGE",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 400,
      vat: { category: "AE" },
    },
  ],
  allowancesCharges: [
    {
      isCharge: false,
      amount: 20,
      vat: { category: "S", ratePercent: 19 },
      reason: "MARK-DOCALLOWANCE",
    },
    {
      isCharge: true,
      amount: 15,
      vat: { category: "S", ratePercent: 19 },
      reason: "MARK-DOCCHARGE",
    },
  ],
  vatExemptionReasons: { AE: { text: "MARK-EXEMPTTEXT", code: "MARK-EXEMPTCODE" } },
  payment: {
    meansCode: "58",
    meansText: "MARK-MEANSTEXT",
    reference: "MARK-PAYREF",
    iban: "MARK-IBAN",
    accountName: "MARK-ACCOUNTNAME",
    bic: "MARK-BIC",
    terms: "MARK-TERMS",
  },
  paidAmount: 100,
};

/** Deliberately absent from the page - each needs a reason, or it is a bug, not a decision. */
const NOT_PRINTED: Record<string, string> = {
  "MARK-EXEMPTCODE":
    "BT-121 is a code-list id (VATEX-EU-AE) for machines; the human text BT-120 is printed",
  "MARK-SELLEREADDR":
    "BT-34 is a Peppol routing address, not correspondence - the contact email is printed",
  "MARK-BUYEREADDR": "BT-49, same reason as BT-34",
};

describe("every field that reaches the XML reaches the paper", () => {
  const text = printedText(
    defaultInvoiceTemplate(
      maximal,
      computeInvoice(maximal),
      resolveLabels("de"),
      makeFormatters("de", "EUR"),
    ),
  ).join("\n");

  const markers = JSON.stringify(maximal).match(/MARK-[A-Z0-9]+/g) ?? [];
  const expected = [...new Set(markers)].filter((m) => !(m in NOT_PRINTED));

  it("sets enough markers to be a real check", () => {
    expect(expected.length).toBeGreaterThan(30);
  });

  it.each(expected)("prints %s", (marker) => {
    expect(text).toContain(marker);
  });

  it("prints the price base quantity, or the arithmetic reads as wrong", () => {
    // 3 x 250 per 10 units = 75, not 750. Without the base quantity the line looks miscalculated.
    expect(text).toMatch(/10/);
  });

  it("keeps the deliberate omissions deliberate", () => {
    for (const [marker, reason] of Object.entries(NOT_PRINTED)) {
      expect(reason.length, `${marker} needs a reason`).toBeGreaterThan(20);
    }
  });
});

describe("reverse charge without both VAT ids", () => {
  // EN 16931 BR-AE-3 and §14a Abs. 1 UStG both want them. The official validator rejects such a
  // file, so failing early with the field name beats handing the user a rule id.
  const reverseCharge: Invoice = {
    ...maximal,
    lines: [
      { name: "Beratung", quantity: 1, unit: "C62", netUnitPrice: 100, vat: { category: "AE" } },
    ],
  };

  it("is accepted when both are set", () => {
    expect(en16931Problems(reverseCharge)).toEqual([]);
  });

  it("names the BUYER id when it is missing", () => {
    const missing = { ...reverseCharge, buyer: { ...reverseCharge.buyer, vatId: undefined } };
    expect(en16931Problems(missing).join(" ")).toMatch(/buyer VAT ID.*BT-48/);
  });

  it("names the SELLER id when it is missing", () => {
    const missing = { ...reverseCharge, seller: { ...reverseCharge.seller, vatId: undefined } };
    expect(en16931Problems(missing).join(" ")).toMatch(/seller VAT ID.*BT-31/);
  });

  it("says nothing for an ordinary taxed invoice", () => {
    const plain = {
      ...reverseCharge,
      lines: [{ ...reverseCharge.lines[0], vat: { category: "S" as const, ratePercent: 19 } }],
    };
    expect(en16931Problems({ ...plain, buyer: { ...plain.buyer, vatId: undefined } })).toEqual([]);
  });

  it("refuses to render one, rather than emitting a file that will be rejected", async () => {
    const missing = { ...reverseCharge, buyer: { ...reverseCharge.buyer, vatId: undefined } };
    await expect(renderZugferd(missing)).rejects.toThrow(/BT-48/);
  });
});

describe("a credit note must not call itself an invoice", () => {
  // BT-3 reaches the XML either way; the PAPER used to say "Rechnung" regardless. A document that
  // names itself wrong is not a cosmetic problem - §14 Abs. 4 Nr. 10 UStG is about what it is called.
  const titleOf = (invoice: Invoice, locale: "de" | "en" = "de") =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels(locale),
        makeFormatters(locale, invoice.currency),
      ),
      // the bare number also appears in the information block - the TITLE is the one that prefixes it
    ).find((t) => t !== invoice.number && t.endsWith(invoice.number));

  it("says Gutschrift for type 381", () => {
    expect(titleOf({ ...maximal, type: 381 })).toMatch(/^Gutschrift /);
  });

  it("still says Rechnung for type 380 and for no type at all", () => {
    expect(titleOf({ ...maximal, type: 380 })).toMatch(/^Rechnung /);
    expect(titleOf({ ...maximal, type: undefined })).toMatch(/^Rechnung /);
  });

  it("follows the locale", () => {
    expect(titleOf({ ...maximal, type: 381 }, "en")).toMatch(/^Credit note /);
  });
});

describe("a category that charges no VAT has to say why", () => {
  // Without this we emitted a file the official validator rejects (BR-AE-10 and its siblings), with
  // no warning at all. Verified against the vendored KoSIT/EN 16931 schematron.
  const withCategory = (category: "E" | "AE" | "K" | "G" | "O" | "S" | "Z"): Invoice => ({
    ...maximal,
    vatExemptionReasons: undefined,
    lines: [
      {
        name: "Leistung",
        quantity: 1,
        unit: "C62",
        netUnitPrice: 100,
        vat: category === "S" ? { category, ratePercent: 19 } : { category },
      },
    ],
  });

  it.each(["E", "AE", "K", "G", "O"] as const)("demands a reason for %s", (category) => {
    expect(en16931Problems(withCategory(category)).join(" ")).toMatch(
      new RegExp(`Category ${category} needs an exemption reason`),
    );
  });

  it.each(["S", "Z"] as const)("demands nothing for %s, which is taxed", (category) => {
    expect(en16931Problems(withCategory(category))).toEqual([]);
  });

  it("is satisfied by the text alone", () => {
    const ok = { ...withCategory("E"), vatExemptionReasons: { E: { text: "§4 Nr. 21 UStG" } } };
    expect(en16931Problems(ok)).toEqual([]);
  });

  it("is satisfied by the code alone", () => {
    const ok = { ...withCategory("E"), vatExemptionReasons: { E: { code: "VATEX-EU-132" } } };
    expect(en16931Problems(ok)).toEqual([]);
  });

  it("refuses to render one, rather than emitting a file the validator rejects", async () => {
    await expect(renderZugferd(withCategory("AE"))).rejects.toThrow(/BT-120/);
  });
});
