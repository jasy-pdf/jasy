import type { Invoice } from "../../src/invoice.ts";

/**
 * ONE invoice that sets EVERY optional field, shared by every test that needs a complete one.
 *
 * Every value is a distinctive `MARK-…` so a test can ask "did this reach the page / the XML".
 * There used to be a second fixture of this name in the order tests, missing six fields - which is
 * why `fixture-is-maximal.test.ts` now checks the claim instead of trusting the name.
 *
 * It deliberately sets the combinations that made real bugs visible: a payee (so PayeeTradeParty
 * collides with the currency code), BOTH a document allowance and a charge (so the totals order
 * collides), item identifiers of all three kinds, and a reverse-charge line (so the exemption
 * reason has a group to sit on).
 */
export const maximalInvoice: Invoice = {
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
          reasonCode: "95", // BT-140
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
      reasonCode: "ZZZ", // BT-105
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
