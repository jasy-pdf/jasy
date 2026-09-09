import { Invoice } from "./invoice.ts";
import { computeInvoice } from "./compute.ts";
import { acDerivedAmount } from "./allowance.ts";
import { supportingDocumentProblems } from "./attachment.ts";

// A friendly pre-flight for the XRechnung (German B2G) profile: it lists, in plain language, the
// fields XRechnung makes mandatory on top of EN16931 - so the user gets actionable guidance BEFORE
// the invoice ever reaches a KoSIT/Schematron gate that would reject it with a cryptic rule id.
// This is a helper, not the authority: the official validator (KoSIT / veraPDF) stays the final gate.

/**
 * Problems the user must see whatever profile they asked for.
 *
 * Two kinds, deliberately in one list: things a validator would REJECT, and one thing a validator
 * would ACCEPT although the document is false. A rejected invoice costs an afternoon; a false one
 * that passes every gate costs a customer relationship, so both belong in the same pre-flight.
 *
 * The wording of each rule below was read out of the vendored EN 16931 schematron, not recalled:
 * the alternatives it allows are load-bearing. Requiring a VAT id where the standard also accepts a
 * tax number would REJECT a valid invoice, and this check throws - a false positive costs the user
 * more than a missing one.
 */
export function en16931Problems(invoice: Invoice): string[] {
  const problems: string[] = [];
  const { seller, buyer } = invoice;

  // The categories PRESENT, taken from the computed breakdown (BG-23) rather than from the lines:
  // BR-AE-03 / BR-AE-04 apply to a document-level allowance or charge too, and those form their own
  // breakdown group even when no line carries the category. Reading the breakdown is reading exactly
  // what the rules are written against.
  const categories = new Set(computeInvoice(invoice).vatBreakdown.map((v) => v.category));

  // BR-AE-02/03/04: reverse charge. Both sides need AN identifier, and the standard accepts
  // alternatives - the seller's tax number does, and so does the buyer's legal registration id.
  if (categories.has("AE")) {
    if (!seller.vatId && !seller.taxNumber) {
      problems.push(
        "Reverse charge (AE) needs a seller identifier - set invoice.seller.vatId (BT-31) or invoice.seller.taxNumber (BT-32).",
      );
    }
    if (!buyer.vatId && !buyer.legalRegistrationId) {
      problems.push(
        "Reverse charge (AE) needs a buyer identifier - set invoice.buyer.vatId (BT-48) or invoice.buyer.legalRegistrationId (BT-47).",
      );
    }
  }

  // BR-IC-02: an intra-community supply is stricter - the buyer's VAT ID, and nothing else, will do.
  if (categories.has("K")) {
    if (!seller.vatId) {
      problems.push(
        "Intra-community supply (K) needs the seller VAT ID - set invoice.seller.vatId (BT-31).",
      );
    }
    if (!buyer.vatId) {
      problems.push(
        "Intra-community supply (K) needs the buyer VAT ID - set invoice.buyer.vatId (BT-48); a legal registration id is not enough here.",
      );
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

  problems.push(
    ...supportingDocumentProblems(invoice.supportingDocuments, "invoice.supportingDocuments"),
  );

  // BR-53: naming a VAT accounting currency without the amount in it states a currency and no
  // figure, which is worse than saying nothing.
  if (invoice.taxCurrency && invoice.taxTotalInTaxCurrency === undefined) {
    problems.push(
      `invoice.taxCurrency is ${invoice.taxCurrency} (BT-6) but invoice.taxTotalInTaxCurrency (BT-111) is missing - the VAT total has to be stated in that currency.`,
    );
  }
  if (invoice.taxTotalInTaxCurrency !== undefined && !invoice.taxCurrency) {
    problems.push(
      "invoice.taxTotalInTaxCurrency (BT-111) is set but invoice.taxCurrency (BT-6) is not - an amount without its currency cannot be read.",
    );
  }

  // NOT a standard rule - the trap that exists because Skonto had no field until 2026-09-09. Entered
  // as an allowance it deducts immediately, although it is only due on early payment: schema-valid,
  // factually wrong, invisible to every validator. Matched on the reason text, which is where a user
  // says what they meant.
  for (const [i, ac] of (invoice.allowancesCharges ?? []).entries()) {
    if (!ac.isCharge && SKONTO_WORDS.test(ac.reason ?? "")) {
      problems.push(
        `invoice.allowancesCharges[${i}] looks like Skonto ("${ac.reason}"). An early-payment discount is not an allowance - it would be deducted immediately although it is only due on early payment. Use invoice.payment.cashDiscounts instead (BT-20).`,
      );
    }
  }

  // An allowance may state BOTH a fixed amount and a base-with-percentage. When the two disagree the
  // amount wins (it is what the totals use), so silence here would print one number and bill another.
  const everyAC = [
    ...(invoice.allowancesCharges ?? []).map(
      (ac, i) => [`invoice.allowancesCharges[${i}]`, ac] as const,
    ),
    ...invoice.lines.flatMap((line, li) =>
      (line.allowancesCharges ?? []).map(
        (ac, i) => [`invoice.lines[${li}].allowancesCharges[${i}]`, ac] as const,
      ),
    ),
  ];
  for (const [where, ac] of everyAC) {
    const derived = acDerivedAmount(ac);
    if (derived !== null && ac.amount !== undefined && Math.abs(derived - ac.amount) > 0.005) {
      problems.push(
        `${where}: amount is ${ac.amount}, but ${ac.percent}% of ${ac.baseAmount} is ${derived}. The amount is what gets billed - drop it to have it derived, or correct one of the two.`,
      );
    }
    if (ac.percent !== undefined && (ac.percent <= 0 || ac.percent > 100)) {
      problems.push(`${where}.percent must be greater than 0 and at most 100, got ${ac.percent}.`);
    }
  }

  // The discount itself has to be a possible one, or the structured BT-20 line is nonsense.
  for (const [i, d] of (invoice.payment?.cashDiscounts ?? []).entries()) {
    const where = `invoice.payment.cashDiscounts[${i}]`;
    if (!(d.percent > 0 && d.percent < 100)) {
      problems.push(`${where}.percent must be greater than 0 and less than 100, got ${d.percent}.`);
    }
    if (!Number.isInteger(d.days) || d.days < 0) {
      problems.push(`${where}.days must be a whole number of days, got ${d.days}.`);
    }
  }

  return problems;
}

/** Words that mean "early-payment discount" in the languages this template speaks. */
const SKONTO_WORDS = /\bskonto\b|\bescompte\b|early[- ]payment discount|cash discount/i;

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

  // A German seller invoicing in a foreign currency still owes the tax authority a Euro figure.
  // Nothing in the schema forces it, so without this the invoice goes out silently deficient -
  // the same shape of trap as Skonto entered as an allowance.
  require(invoice.currency === "EUR" ||
    invoice.taxCurrency, `The invoice is in ${invoice.currency}, so the VAT total is also owed in EUR - set invoice.taxCurrency (BT-6) and invoice.taxTotalInTaxCurrency (BT-111).`);

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

  // A credit transfer (the default, or codes 30 / 58) must carry an IBAN. 59 used to be in this
  // list and is NOT a credit transfer - UNCL 4461 has 58 = SEPA credit transfer, 59 = SEPA DIRECT
  // DEBIT - so a direct-debit invoice was being told to supply the payee IBAN it does not need.
  const creditTransfer = !payment?.meansCode || ["30", "58"].includes(payment.meansCode);
  require(!creditTransfer ||
    payment?.iban, "XRechnung credit transfer needs an IBAN - set invoice.payment.iban (BT-84).");

  // ... and its mirror image: a collection without a mandate reference cannot be checked by the payer.
  const directDebit = ["49", "59"].includes(payment?.meansCode ?? "");
  require(!directDebit ||
    payment?.directDebit
      ?.mandateReference, "A SEPA direct debit needs a mandate reference - set invoice.payment.directDebit.mandateReference (BT-89).");

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
