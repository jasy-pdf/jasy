import {
  ServicePeriod,
  AllowanceCharge,
  Buyer,
  Invoice,
  InvoiceLine,
  PostalAddress,
  Seller,
} from "./invoice.ts";
import { ComputedInvoice, VatBreakdownEntry } from "./compute.ts";
import { BUSINESS_PROCESS, CiiProfile, GUIDELINE } from "./cii.ts";
import { paymentTermsText } from "./skonto.ts";
import { acAmount, hasPercentage } from "./allowance.ts";
import { PrecedingInvoice, SupportingDocument } from "./invoice.ts";
import { toBase64 } from "./attachment.ts";

// Emits the OASIS UBL Invoice XML for the EN16931 profile - the SECOND permitted syntax (PEPPOL is
// UBL, and XRechnung accepts it too). Same semantic model (BT/BG) + pre-computed totals as the CII
// emitter, just the UBL structure: `cac:` aggregate + `cbc:` basic components, in XSD sequence order.

const NS = {
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The same, plus the quote: a `"` is fine in element TEXT but ends an attribute value early, and
 * BT-82 is the first attribute we fill with free text. Kept separate so element output is untouched.
 */
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

/** A leaf `<tag attrs>value</tag>`; "" when value is null/undefined/"". */
function el(
  tag: string,
  value: string | number | undefined | null,
  attrs: Record<string, string> = {},
): string {
  if (value === undefined || value === null || value === "") return "";
  const a = Object.keys(attrs)
    .map((k) => ` ${k}="${escAttr(attrs[k])}"`)
    .join("");
  return `<${tag}${a}>${esc(String(value))}</${tag}>`;
}

/** A wrapper around already-built children; "" when there are no children. */
function wrap(tag: string, children: string[]): string {
  const inner = children.filter(Boolean).join("");
  return inner ? `<${tag}>${inner}</${tag}>` : "";
}

/** A monetary amount with the document currency (UBL requires the currencyID attribute). */
const money = (tag: string, n: number, currency: string) =>
  el(tag, n.toFixed(2), { currencyID: currency });

function address(a: PostalAddress): string {
  return wrapAddress("cac:PostalAddress", a);
}

/** The same address body under a chosen tag: a Party has cac:PostalAddress, a Location cac:Address. */
function wrapAddress(tag: string, a: PostalAddress): string {
  return wrap(tag, [
    el("cbc:StreetName", a.line1), // BT-35 / BT-50
    el("cbc:AdditionalStreetName", a.line2), // BT-36 / BT-51
    el("cbc:CityName", a.city), // BT-37 / BT-52
    el("cbc:PostalZone", a.postCode), // BT-38 / BT-53
    el("cbc:CountrySubentity", a.subdivision), // BT-39 / BT-54
    a.line3 ? wrap("cac:AddressLine", [el("cbc:Line", a.line3)]) : "", // BT-162 / BT-163
    wrap("cac:Country", [el("cbc:IdentificationCode", a.country)]), // BT-40 / BT-55
  ]);
}

function contact(c: { name?: string; phone?: string; email?: string } | undefined): string {
  if (!c) return "";
  return wrap("cac:Contact", [
    el("cbc:Name", c.name), // BT-41 / BT-56
    el("cbc:Telephone", c.phone), // BT-42 / BT-57
    el("cbc:ElectronicMail", c.email), // BT-43 / BT-58
  ]);
}

/** `creditorId` is BT-90: UBL puts it on the party, not on the payment means. */
function sellerParty(s: Seller, creditorId?: string): string {
  return wrap("cac:AccountingSupplierParty", [
    wrap("cac:Party", [
      s.electronicAddress ? el("cbc:EndpointID", s.electronicAddress, { schemeID: "EM" }) : "", // BT-34
      s.identifier ? wrap("cac:PartyIdentification", [el("cbc:ID", s.identifier)]) : "", // BT-29
      // BT-90, the creditor identifier. UBL hangs it on the SELLER party, not on the payment.
      creditorId
        ? wrap("cac:PartyIdentification", [el("cbc:ID", creditorId, { schemeID: "SEPA" })])
        : "",
      s.tradingName ? wrap("cac:PartyName", [el("cbc:Name", s.tradingName)]) : "", // BT-28
      address(s.address),
      s.vatId
        ? wrap("cac:PartyTaxScheme", [
            el("cbc:CompanyID", s.vatId), // BT-31
            wrap("cac:TaxScheme", [el("cbc:ID", "VAT")]),
          ])
        : "",
      s.taxNumber
        ? wrap("cac:PartyTaxScheme", [
            el("cbc:CompanyID", s.taxNumber), // BT-32
            wrap("cac:TaxScheme", [el("cbc:ID", "FC")]),
          ])
        : "",
      wrap("cac:PartyLegalEntity", [
        el("cbc:RegistrationName", s.name), // BT-27
        el("cbc:CompanyID", s.legalRegistrationId), // BT-30
        el("cbc:CompanyLegalForm", s.additionalLegalInfo), // BT-33
      ]),
      contact(s.contact),
    ]),
  ]);
}

function buyerParty(b: Buyer): string {
  return wrap("cac:AccountingCustomerParty", [
    wrap("cac:Party", [
      b.electronicAddress ? el("cbc:EndpointID", b.electronicAddress, { schemeID: "EM" }) : "", // BT-49
      b.identifier ? wrap("cac:PartyIdentification", [el("cbc:ID", b.identifier)]) : "", // BT-46
      b.tradingName ? wrap("cac:PartyName", [el("cbc:Name", b.tradingName)]) : "", // BT-45
      address(b.address),
      b.vatId
        ? wrap("cac:PartyTaxScheme", [
            el("cbc:CompanyID", b.vatId), // BT-48
            wrap("cac:TaxScheme", [el("cbc:ID", "VAT")]),
          ])
        : "",
      wrap("cac:PartyLegalEntity", [
        el("cbc:RegistrationName", b.name), // BT-44
        el("cbc:CompanyID", b.legalRegistrationId), // BT-47
      ]),
      contact(b.contact),
    ]),
  ]);
}

// The VAT category. The wrapper tag differs by context: a line item uses cac:ClassifiedTaxCategory,
// a tax subtotal / allowance-charge uses cac:TaxCategory.
function taxCategory(
  tag: "cac:TaxCategory" | "cac:ClassifiedTaxCategory",
  category: string,
  rate: number,
  exemptionText?: string,
  exemptionCode?: string,
) {
  return wrap(tag, [
    el("cbc:ID", category),
    el("cbc:Percent", rate),
    el("cbc:TaxExemptionReasonCode", exemptionCode),
    el("cbc:TaxExemptionReason", exemptionText),
    wrap("cac:TaxScheme", [el("cbc:ID", "VAT")]),
  ]);
}

function docAllowanceCharge(ac: AllowanceCharge, currency: string): string {
  return wrap("cac:AllowanceCharge", [
    el("cbc:ChargeIndicator", String(ac.isCharge)),
    el("cbc:AllowanceChargeReasonCode", ac.reasonCode), // BT-98 / BT-105
    el("cbc:AllowanceChargeReason", ac.reason), // BT-97 / BT-104
    // UBL splits the pair around the amount: the factor before it, the base after.
    hasPercentage(ac) ? el("cbc:MultiplierFactorNumeric", ac.percent) : "", // BT-94 / BT-101
    money("cbc:Amount", acAmount(ac), currency), // BT-92 / BT-99
    hasPercentage(ac) ? money("cbc:BaseAmount", ac.baseAmount, currency) : "", // BT-93 / BT-100
    taxCategory("cac:TaxCategory", ac.vat.category, ac.vat.ratePercent ?? 0),
  ]);
}

/** A LINE-level allowance/charge (BG-27 / BG-28) - no tax category; the line's BT-151 governs. */
function lineAllowanceCharge(ac: AllowanceCharge, currency: string): string {
  return wrap("cac:AllowanceCharge", [
    el("cbc:ChargeIndicator", String(ac.isCharge)),
    el("cbc:AllowanceChargeReasonCode", ac.reasonCode), // BT-140 / BT-145
    el("cbc:AllowanceChargeReason", ac.reason), // BT-139 / BT-144
    hasPercentage(ac) ? el("cbc:MultiplierFactorNumeric", ac.percent) : "", // BT-138 / BT-143
    money("cbc:Amount", acAmount(ac), currency), // BT-136 / BT-141
    hasPercentage(ac) ? money("cbc:BaseAmount", ac.baseAmount, currency) : "", // BT-137 / BT-142
  ]);
}

function taxSubtotal(g: VatBreakdownEntry, currency: string): string {
  return wrap("cac:TaxSubtotal", [
    money("cbc:TaxableAmount", g.taxableAmount, currency), // BT-116
    money("cbc:TaxAmount", g.taxAmount, currency), // BT-117
    taxCategory("cac:TaxCategory", g.category, g.ratePercent, g.exemption?.text, g.exemption?.code),
  ]);
}

/**
 * BG-24: an extra document. UBL nests the payload one level deeper than CII - the binary and the
 * external link both live inside `cac:Attachment`, and the link is itself wrapped again.
 */
function supportingDocument(doc: SupportingDocument): string {
  const binary = doc.file
    ? `<cbc:EmbeddedDocumentBinaryObject mimeCode="${escAttr(doc.file.mimeType)}" filename="${escAttr(doc.file.filename)}">${toBase64(doc.file.content)}</cbc:EmbeddedDocumentBinaryObject>`
    : "";
  return wrap("cac:AdditionalDocumentReference", [
    el("cbc:ID", doc.reference), // BT-122
    el("cbc:DocumentDescription", doc.description), // BT-123
    wrap("cac:Attachment", [
      binary, // BT-125
      doc.url ? wrap("cac:ExternalReference", [el("cbc:URI", doc.url)]) : "", // BT-124
    ]),
  ]);
}

/** BG-3: the invoice being corrected or credited. */
function billingReference(ref: PrecedingInvoice): string {
  return wrap("cac:BillingReference", [
    wrap("cac:InvoiceDocumentReference", [
      el("cbc:ID", ref.number), // BT-25
      el("cbc:IssueDate", ref.issueDate), // BT-26
    ]),
  ]);
}

/** The service period (BG-14 on the document, BG-26 on a line) - UBL's `cac:InvoicePeriod`. */
function invoicePeriod(p?: ServicePeriod): string {
  return p
    ? wrap("cac:InvoicePeriod", [
        el("cbc:StartDate", p.start), // BT-73 / BT-134
        el("cbc:EndDate", p.end), // BT-74 / BT-135
      ])
    : "";
}

function invoiceLine(l: InvoiceLine, net: number, index: number, currency: string): string {
  return wrap("cac:InvoiceLine", [
    el("cbc:ID", l.id ?? String(index + 1)), // BT-126
    l.note ? el("cbc:Note", l.note) : "", // BT-127
    el("cbc:InvoicedQuantity", l.quantity, { unitCode: l.unit }), // BT-129 / BT-130
    money("cbc:LineExtensionAmount", net, currency), // BT-131
    el("cbc:AccountingCost", l.buyerAccountingRef), // BT-133
    invoicePeriod(l.period), // BG-26
    l.orderLineRef
      ? wrap("cac:OrderLineReference", [el("cbc:LineID", l.orderLineRef)]) // BT-132
      : "",
    l.objectRef ? wrap("cac:DocumentReference", [el("cbc:ID", l.objectRef)]) : "", // BT-128
    ...(l.allowancesCharges ?? []).map((ac) => lineAllowanceCharge(ac, currency)), // BG-27 / BG-28
    wrap("cac:Item", [
      el("cbc:Description", l.description), // BT-154
      el("cbc:Name", l.name), // BT-153
      // BUYER before SELLER - the UBL ItemType sequence, which reads the other way round.
      l.buyerItemId ? wrap("cac:BuyersItemIdentification", [el("cbc:ID", l.buyerItemId)]) : "", // BT-156
      l.sellerItemId ? wrap("cac:SellersItemIdentification", [el("cbc:ID", l.sellerItemId)]) : "", // BT-155
      l.standardItemId
        ? wrap("cac:StandardItemIdentification", [
            el("cbc:ID", l.standardItemId, { schemeID: "0160" }),
          ]) // BT-157
        : "",
      l.originCountry
        ? wrap("cac:OriginCountry", [el("cbc:IdentificationCode", l.originCountry)]) // BT-159
        : "",
      taxCategory("cac:ClassifiedTaxCategory", l.vat.category, l.vat.ratePercent ?? 0), // BG-30
    ]),
    wrap("cac:Price", [
      money("cbc:PriceAmount", l.netUnitPrice, currency), // BT-146
      l.priceBaseQuantity
        ? el("cbc:BaseQuantity", l.priceBaseQuantity, { unitCode: l.unit }) // BT-149 / BT-150
        : "",
    ]),
  ]);
}

export function toUBL(
  invoice: Invoice,
  computed: ComputedInvoice,
  profile: CiiProfile = "en16931",
): string {
  const cur = invoice.currency;
  const docAC = invoice.allowancesCharges ?? [];

  const head = [
    el("cbc:CustomizationID", GUIDELINE[profile]), // BT-24
    profile === "xrechnung" ? el("cbc:ProfileID", BUSINESS_PROCESS) : "", // BT-23
    el("cbc:ID", invoice.number), // BT-1
    el("cbc:IssueDate", invoice.issueDate), // BT-2
    el("cbc:DueDate", invoice.dueDate), // BT-9
    el("cbc:InvoiceTypeCode", invoice.type ?? 380), // BT-3
    // BT-21 has no element of its own in UBL. The EN 16931 binding prefixes the note with the
    // subject code in the form #CODE#, which is why this is string surgery and not a field.
    ...(invoice.notes ?? []).map((n) =>
      el("cbc:Note", invoice.noteSubjectCode ? `#${invoice.noteSubjectCode}#${n}` : n),
    ), // BT-22 (+ BT-21)
    el("cbc:DocumentCurrencyCode", cur), // BT-5
    el("cbc:TaxCurrencyCode", invoice.taxCurrency), // BT-6
    el("cbc:AccountingCost", invoice.buyerAccountingRef), // BT-19 - BEFORE the buyer reference
    el("cbc:BuyerReference", invoice.buyerReference), // BT-10 (Leitweg-ID)
    invoicePeriod(invoice.period), // BG-14
    invoice.purchaseOrderRef || invoice.salesOrderRef
      ? wrap("cac:OrderReference", [
          el("cbc:ID", invoice.purchaseOrderRef), // BT-13
          el("cbc:SalesOrderID", invoice.salesOrderRef), // BT-14
        ])
      : "",
    // BillingReference sits between the order and the contract reference in the InvoiceType sequence.
    ...(invoice.precedingInvoices ?? []).map(billingReference), // BG-3
    invoice.tenderRef
      ? wrap("cac:OriginatorDocumentReference", [el("cbc:ID", invoice.tenderRef)]) // BT-17
      : "",
    invoice.contractRef
      ? wrap("cac:ContractDocumentReference", [el("cbc:ID", invoice.contractRef)]) // BT-12
      : "",
    ...(invoice.supportingDocuments ?? []).map(supportingDocument), // BG-24
    // BT-18 shares the element with BG-24 and is told apart by its document type code.
    invoice.objectRef
      ? wrap("cac:AdditionalDocumentReference", [
          el("cbc:ID", invoice.objectRef),
          el("cbc:DocumentTypeCode", "130"),
        ])
      : "",
    invoice.projectRef ? wrap("cac:ProjectReference", [el("cbc:ID", invoice.projectRef)]) : "", // BT-11
  ];

  const d = invoice.delivery;
  const delivery =
    d?.date || d?.recipientName || d?.address || d?.locationId
      ? wrap("cac:Delivery", [
          el("cbc:ActualDeliveryDate", d?.date), // BT-72
          // A LocationType holds cac:Address - `cac:PostalAddress` belongs to a Party, not here.
          d?.address || d?.locationId
            ? wrap("cac:DeliveryLocation", [
                el("cbc:ID", d?.locationId), // BT-71
                d?.address ? wrapAddress("cac:Address", d.address) : "", // BG-15
              ])
            : "",
          d?.recipientName
            ? wrap("cac:DeliveryParty", [wrap("cac:PartyName", [el("cbc:Name", d.recipientName)])])
            : "", // BT-70
        ])
      : "";

  const p = invoice.payment;
  const paymentMeans =
    p && (p.iban || p.meansCode)
      ? wrap("cac:PaymentMeans", [
          el(
            "cbc:PaymentMeansCode",
            p.meansCode ?? "58",
            p.meansText ? { name: p.meansText } : undefined,
          ), // BT-81 + BT-82
          el("cbc:PaymentID", p.reference), // BT-83
          p.iban
            ? wrap("cac:PayeeFinancialAccount", [
                el("cbc:ID", p.iban), // BT-84
                el("cbc:Name", p.accountName), // BT-85
                p.bic ? wrap("cac:FinancialInstitutionBranch", [el("cbc:ID", p.bic)]) : "", // BT-86
              ])
            : "",
          // BG-19. UBL keeps the mandate together; CII scatters the same three fields over three
          // different blocks, which is why they are read from one object rather than three.
          p.directDebit
            ? wrap("cac:PaymentMandate", [
                el("cbc:ID", p.directDebit.mandateReference), // BT-89
                p.directDebit.debitedIban
                  ? wrap("cac:PayerFinancialAccount", [el("cbc:ID", p.directDebit.debitedIban)]) // BT-91
                  : "",
              ])
            : "",
        ])
      : "";

  // BT-20 - the same text the CII gets, from the same function, or the two syntaxes would disagree.
  const termsText = paymentTermsText(
    p?.terms,
    p?.cashDiscounts,
    invoice.issueDate,
    computed.grandTotal,
  );
  const paymentTerms = termsText ? wrap("cac:PaymentTerms", [el("cbc:Note", termsText)]) : "";

  const taxTotal =
    wrap("cac:TaxTotal", [
      money("cbc:TaxAmount", computed.taxTotal, cur), // BT-110
      ...computed.vatBreakdown.map((g) => taxSubtotal(g, cur)), // BG-23
    ]) +
    // BT-111 is a SECOND TaxTotal with nothing but the amount - the breakdown is not repeated,
    // because it is the same tax expressed in another currency, not a second tax.
    (invoice.taxCurrency && invoice.taxTotalInTaxCurrency !== undefined
      ? wrap("cac:TaxTotal", [
          money("cbc:TaxAmount", invoice.taxTotalInTaxCurrency, invoice.taxCurrency),
        ])
      : "");

  const monetaryTotal = wrap("cac:LegalMonetaryTotal", [
    money("cbc:LineExtensionAmount", computed.lineTotal, cur), // BT-106
    money("cbc:TaxExclusiveAmount", computed.taxBasisTotal, cur), // BT-109
    money("cbc:TaxInclusiveAmount", computed.grandTotal, cur), // BT-112
    docAC.some((a) => !a.isCharge)
      ? money("cbc:AllowanceTotalAmount", computed.allowanceTotal, cur)
      : "", // BT-107
    docAC.some((a) => a.isCharge) ? money("cbc:ChargeTotalAmount", computed.chargeTotal, cur) : "", // BT-108
    computed.paidAmount ? money("cbc:PrepaidAmount", computed.paidAmount, cur) : "", // BT-113
    computed.roundingAmount ? money("cbc:PayableRoundingAmount", computed.roundingAmount, cur) : "", // BT-114
    money("cbc:PayableAmount", computed.duePayable, cur), // BT-115
  ]);

  const payee =
    invoice.payeeName || invoice.payeeIdentifier // BG-10
      ? wrap("cac:PayeeParty", [
          invoice.payeeIdentifier
            ? wrap("cac:PartyIdentification", [el("cbc:ID", invoice.payeeIdentifier)]) // BT-60
            : "",
          invoice.payeeName ? wrap("cac:PartyName", [el("cbc:Name", invoice.payeeName)]) : "", // BT-59
          invoice.payeeLegalRegistrationId
            ? wrap("cac:PartyLegalEntity", [el("cbc:CompanyID", invoice.payeeLegalRegistrationId)]) // BT-61
            : "",
        ])
      : "";
  const lines = invoice.lines.map((l, i) => invoiceLine(l, computed.lineNets[i], i, cur));

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Invoice xmlns="${NS.inv}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">` +
    head.filter(Boolean).join("") +
    sellerParty(invoice.seller, invoice.payment?.directDebit?.creditorId) +
    buyerParty(invoice.buyer) +
    payee +
    delivery +
    paymentMeans +
    paymentTerms +
    docAC.map((ac) => docAllowanceCharge(ac, cur)).join("") +
    taxTotal +
    monetaryTotal +
    lines.join("") +
    `</Invoice>`
  );
}
