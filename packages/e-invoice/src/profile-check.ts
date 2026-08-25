import { Invoice } from "./invoice.ts";

// A friendly pre-flight for the XRechnung (German B2G) profile: it lists, in plain language, the
// fields XRechnung makes mandatory on top of EN16931 - so the user gets actionable guidance BEFORE
// the invoice ever reaches a KoSIT/Schematron gate that would reject it with a cryptic rule id.
// This is a helper, not the authority: the official validator (KoSIT / veraPDF) stays the final gate.

/**
 * Problems that would make ANY profile fail, so they are checked whatever the user asked for.
 *
 * EN 16931 BR-AE-3 / BR-IC-3: an invoice carrying a reverse-charge (AE) or intra-community (K) VAT
 * category must state BOTH VAT identifiers. German law says the same in §14a Abs. 1 UStG. Such a
 * file is rejected by the official validator anyway - catching it here names the missing field
 * instead of handing back a rule id.
 */
export function en16931Problems(invoice: Invoice): string[] {
  const problems: string[] = [];
  const categories = new Set(invoice.lines.map((l) => l.vat.category));
  const needsBothVatIds = categories.has("AE") || categories.has("K");

  if (needsBothVatIds) {
    const which = categories.has("AE") ? "Reverse charge (AE)" : "Intra-community supply (K)";
    if (!invoice.seller.vatId) {
      problems.push(`${which} needs the seller VAT ID - set invoice.seller.vatId (BT-31).`);
    }
    if (!invoice.buyer.vatId) {
      problems.push(`${which} needs the buyer VAT ID - set invoice.buyer.vatId (BT-48).`);
    }
  }
  // BR-E-10 / BR-AE-10 / BR-IC-10 / BR-G-10 / BR-O-10: every category that charges no (or zero) VAT
  // must SAY why. Without it the official validator rejects the file, and the paper is legally
  // deficient too - §14a Abs. 5 UStG prescribes the reverse-charge wording word for word.
  const given = invoice.vatExemptionReasons ?? {};
  for (const category of NEEDS_EXEMPTION_REASON) {
    if (!categories.has(category)) continue;
    const reason = given[category];
    if (!reason?.text && !reason?.code) {
      problems.push(
        `Category ${category} needs an exemption reason - set invoice.vatExemptionReasons.${category}.text (BT-120) or .code (BT-121).`,
      );
    }
  }

  return problems;
}

/** The VAT categories EN 16931 requires an exemption reason for. `S` and `Z` are taxed, so not those. */
const NEEDS_EXEMPTION_REASON = ["E", "AE", "K", "G", "O"] as const;

/** Plain-language problems that would make `invoice` fail XRechnung. Empty array = good to go. */
export function xrechnungProblems(invoice: Invoice): string[] {
  const problems: string[] = [];
  const require = (ok: unknown, message: string) => {
    if (!ok) problems.push(message);
  };
  const { seller, buyer, payment } = invoice;
  problems.push(...en16931Problems(invoice));

  require(invoice.buyerReference, "XRechnung needs the Leitweg-ID - set invoice.buyerReference (BT-10).");

  require(seller.electronicAddress, "XRechnung needs the seller's electronic address - set invoice.seller.electronicAddress (BT-34).");
  require(buyer.electronicAddress, "XRechnung needs the buyer's electronic address - set invoice.buyer.electronicAddress (BT-49).");

  require(seller.contact
    ?.name, "XRechnung needs a seller contact name - set invoice.seller.contact.name (BT-41).");
  require(seller.contact
    ?.phone, "XRechnung needs a seller contact phone - set invoice.seller.contact.phone (BT-42).");
  require(seller.contact
    ?.email, "XRechnung needs a seller contact email - set invoice.seller.contact.email (BT-43).");

  require(seller.address
    .city, "XRechnung needs the seller city - set invoice.seller.address.city (BT-37).");
  require(seller.address
    .postCode, "XRechnung needs the seller post code - set invoice.seller.address.postCode (BT-38).");

  require(invoice.dueDate ||
    payment?.terms, "XRechnung needs a due date or payment terms - set invoice.dueDate (BT-9) or invoice.payment.terms (BT-20).");

  // A credit transfer (the default / codes 30, 58, 59) must carry an IBAN.
  const creditTransfer = !payment?.meansCode || ["30", "58", "59"].includes(payment.meansCode);
  require(!creditTransfer ||
    payment?.iban, "XRechnung credit transfer needs an IBAN - set invoice.payment.iban (BT-84).");

  // A period that runs backwards is silently accepted by the schema and read as nonsense downstream,
  // so it is worth catching here where the message can name the field.
  const periods: [string, { start: string; end: string } | undefined][] = [
    ["invoice.period (BG-14)", invoice.period],
    ...invoice.lines.map(
      (l, i) => [`invoice.lines[${i}].period (BG-26)`, l.period] as [string, typeof l.period],
    ),
  ];
  for (const [where, p] of periods) {
    if (p && p.end < p.start) {
      problems.push(`${where} ends before it starts: ${p.start} to ${p.end}.`);
    }
  }

  // §14 Abs. 4 Nr. 6 UStG, and the XRechnung rule that mirrors it: a delivery DATE or a PERIOD. The
  // schematron accepts either, so this only warns when neither is there.
  // §14 Abs. 4 Nr. 6 UStG, and the XRechnung rule that mirrors it word for word: a delivery date, OR
  // a document period, OR a period on EVERY line - "some lines" does not satisfy it.
  require(invoice.delivery?.date ||
    invoice.period ||
    (invoice.lines.length > 0 &&
      invoice.lines.every(
        (l) => l.period,
      )), "XRechnung needs a delivery date or a service period - set invoice.delivery.date (BT-72), invoice.period (BG-14), or a period on every line (BG-26).");

  return problems;
}
