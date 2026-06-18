import { AllowanceCharge, Buyer, Invoice, InvoiceLine, PostalAddress, Seller } from "./invoice";
import { ComputedInvoice, VatBreakdownEntry } from "./compute";
import { BUSINESS_PROCESS, CiiProfile, GUIDELINE } from "./cii";

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

/** A leaf `<tag attrs>value</tag>`; "" when value is null/undefined/"". */
function el(
  tag: string,
  value: string | number | undefined | null,
  attrs: Record<string, string> = {},
): string {
  if (value === undefined || value === null || value === "") return "";
  const a = Object.keys(attrs)
    .map((k) => ` ${k}="${esc(attrs[k])}"`)
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
  return wrap("cac:PostalAddress", [
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

function sellerParty(s: Seller): string {
  return wrap("cac:AccountingSupplierParty", [
    wrap("cac:Party", [
      s.electronicAddress ? el("cbc:EndpointID", s.electronicAddress, { schemeID: "EM" }) : "", // BT-34
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
      ]),
      contact(s.contact),
    ]),
  ]);
}

function buyerParty(b: Buyer): string {
  return wrap("cac:AccountingCustomerParty", [
    wrap("cac:Party", [
      b.electronicAddress ? el("cbc:EndpointID", b.electronicAddress, { schemeID: "EM" }) : "", // BT-49
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
    money("cbc:Amount", ac.amount, currency), // BT-92 / BT-99
    taxCategory("cac:TaxCategory", ac.vat.category, ac.vat.ratePercent ?? 0),
  ]);
}

function taxSubtotal(g: VatBreakdownEntry, currency: string): string {
  return wrap("cac:TaxSubtotal", [
    money("cbc:TaxableAmount", g.taxableAmount, currency), // BT-116
    money("cbc:TaxAmount", g.taxAmount, currency), // BT-117
    taxCategory("cac:TaxCategory", g.category, g.ratePercent, g.exemption?.text, g.exemption?.code),
  ]);
}

function invoiceLine(l: InvoiceLine, net: number, index: number, currency: string): string {
  return wrap("cac:InvoiceLine", [
    el("cbc:ID", l.id ?? String(index + 1)), // BT-126
    l.note ? el("cbc:Note", l.note) : "", // BT-127
    el("cbc:InvoicedQuantity", l.quantity, { unitCode: l.unit }), // BT-129 / BT-130
    money("cbc:LineExtensionAmount", net, currency), // BT-131
    wrap("cac:Item", [
      el("cbc:Description", l.description), // BT-154
      el("cbc:Name", l.name), // BT-153
      l.sellerItemId ? wrap("cac:SellersItemIdentification", [el("cbc:ID", l.sellerItemId)]) : "", // BT-155
      l.buyerItemId ? wrap("cac:BuyersItemIdentification", [el("cbc:ID", l.buyerItemId)]) : "", // BT-156
      l.standardItemId
        ? wrap("cac:StandardItemIdentification", [el("cbc:ID", l.standardItemId, { schemeID: "0160" })]) // BT-157
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
    ...(invoice.notes ?? []).map((n) => el("cbc:Note", n)), // BT-22
    el("cbc:DocumentCurrencyCode", cur), // BT-5
    el("cbc:BuyerReference", invoice.buyerReference), // BT-10 (Leitweg-ID)
    invoice.purchaseOrderRef ? wrap("cac:OrderReference", [el("cbc:ID", invoice.purchaseOrderRef)]) : "", // BT-13
    invoice.contractRef
      ? wrap("cac:ContractDocumentReference", [el("cbc:ID", invoice.contractRef)]) // BT-12
      : "",
  ];

  const d = invoice.delivery;
  const delivery =
    d?.date || d?.recipientName || d?.address
      ? wrap("cac:Delivery", [
          el("cbc:ActualDeliveryDate", d?.date), // BT-72
          d?.address ? wrap("cac:DeliveryLocation", [address(d.address)]) : "", // BG-15
          d?.recipientName ? wrap("cac:DeliveryParty", [wrap("cac:PartyName", [el("cbc:Name", d.recipientName)])]) : "", // BT-70
        ])
      : "";

  const p = invoice.payment;
  const paymentMeans =
    p && (p.iban || p.meansCode)
      ? wrap("cac:PaymentMeans", [
          el("cbc:PaymentMeansCode", p.meansCode ?? "58"), // BT-81
          el("cbc:PaymentID", p.reference), // BT-83
          p.iban
            ? wrap("cac:PayeeFinancialAccount", [
                el("cbc:ID", p.iban), // BT-84
                el("cbc:Name", p.accountName), // BT-85
                p.bic ? wrap("cac:FinancialInstitutionBranch", [el("cbc:ID", p.bic)]) : "", // BT-86
              ])
            : "",
        ])
      : "";

  const paymentTerms = p?.terms ? wrap("cac:PaymentTerms", [el("cbc:Note", p.terms)]) : ""; // BT-20

  const taxTotal = wrap("cac:TaxTotal", [
    money("cbc:TaxAmount", computed.taxTotal, cur), // BT-110
    ...computed.vatBreakdown.map((g) => taxSubtotal(g, cur)), // BG-23
  ]);

  const monetaryTotal = wrap("cac:LegalMonetaryTotal", [
    money("cbc:LineExtensionAmount", computed.lineTotal, cur), // BT-106
    money("cbc:TaxExclusiveAmount", computed.taxBasisTotal, cur), // BT-109
    money("cbc:TaxInclusiveAmount", computed.grandTotal, cur), // BT-112
    docAC.some((a) => !a.isCharge) ? money("cbc:AllowanceTotalAmount", computed.allowanceTotal, cur) : "", // BT-107
    docAC.some((a) => a.isCharge) ? money("cbc:ChargeTotalAmount", computed.chargeTotal, cur) : "", // BT-108
    computed.paidAmount ? money("cbc:PrepaidAmount", computed.paidAmount, cur) : "", // BT-113
    money("cbc:PayableAmount", computed.duePayable, cur), // BT-115
  ]);

  const lines = invoice.lines.map((l, i) => invoiceLine(l, computed.lineNets[i], i, cur));

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Invoice xmlns="${NS.inv}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}">` +
    head.filter(Boolean).join("") +
    sellerParty(invoice.seller) +
    buyerParty(invoice.buyer) +
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
