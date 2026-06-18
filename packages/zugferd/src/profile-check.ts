import { Invoice } from "./invoice";

// A friendly pre-flight for the XRechnung (German B2G) profile: it lists, in plain language, the
// fields XRechnung makes mandatory on top of EN16931 - so the user gets actionable guidance BEFORE
// the invoice ever reaches a KoSIT/Schematron gate that would reject it with a cryptic rule id.
// This is a helper, not the authority: the official validator (KoSIT / veraPDF) stays the final gate.

/** Plain-language problems that would make `invoice` fail XRechnung. Empty array = good to go. */
export function xrechnungProblems(invoice: Invoice): string[] {
  const problems: string[] = [];
  const require = (ok: unknown, message: string) => {
    if (!ok) problems.push(message);
  };
  const { seller, buyer, payment } = invoice;

  require(invoice.buyerReference, "XRechnung needs the Leitweg-ID — set invoice.buyerReference (BT-10).");

  require(
    seller.electronicAddress,
    "XRechnung needs the seller's electronic address — set invoice.seller.electronicAddress (BT-34).",
  );
  require(
    buyer.electronicAddress,
    "XRechnung needs the buyer's electronic address — set invoice.buyer.electronicAddress (BT-49).",
  );

  require(seller.contact?.name, "XRechnung needs a seller contact name — set invoice.seller.contact.name (BT-41).");
  require(seller.contact?.phone, "XRechnung needs a seller contact phone — set invoice.seller.contact.phone (BT-42).");
  require(seller.contact?.email, "XRechnung needs a seller contact email — set invoice.seller.contact.email (BT-43).");

  require(seller.address.city, "XRechnung needs the seller city — set invoice.seller.address.city (BT-37).");
  require(seller.address.postCode, "XRechnung needs the seller post code — set invoice.seller.address.postCode (BT-38).");

  require(
    invoice.dueDate || payment?.terms,
    "XRechnung needs a due date or payment terms — set invoice.dueDate (BT-9) or invoice.payment.terms (BT-20).",
  );

  // A credit transfer (the default / codes 30, 58, 59) must carry an IBAN.
  const creditTransfer = !payment?.meansCode || ["30", "58", "59"].includes(payment.meansCode);
  require(
    !creditTransfer || payment?.iban,
    "XRechnung credit transfer needs an IBAN — set invoice.payment.iban (BT-84).",
  );

  return problems;
}
