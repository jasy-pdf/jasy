import { AllowanceCharge, Buyer, Invoice, InvoiceLine, PostalAddress, Seller } from "./invoice";
import { ComputedInvoice, VatBreakdownEntry } from "./compute";

// Emits the UN/CEFACT Cross Industry Invoice (CII) XML for the EN16931 profile. The structure is
// order-sensitive (it follows the CII XSD sequence); every element is mapped to its BT/BG code.
// Amounts come pre-computed from `computeInvoice` so the totals are internally consistent.

const NS = {
  rsm: "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  ram: "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  udt: "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
};

/** The profiles this generator emits CII for. */
export type CiiProfile = "en16931" | "xrechnung";

/** Guideline identifier (BT-24) per profile: plain EN16931, or the German XRechnung 3.0 CIUS.
 *  Shared with the UBL emitter. */
export const GUIDELINE: Record<CiiProfile, string> = {
  en16931: "urn:cen.eu:en16931:2017",
  xrechnung: "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
};

/** Business process (BT-23) — the PEPPOL billing process; XRechnung requires it. */
export const BUSINESS_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

/** XML-escape text content (`&`, `<`, `>` are enough for element text + double-quoted attrs). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A leaf element `<tag attrs>value</tag>`; returns "" when value is null/undefined/"". */
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

/** A wrapper element around already-built children; returns "" when there are no children. */
function wrap(tag: string, children: string[]): string {
  const inner = children.filter(Boolean).join("");
  return inner ? `<${tag}>${inner}</${tag}>` : "";
}

const date102 = (iso: string) =>
  `<udt:DateTimeString format="102">${iso.replace(/-/g, "")}</udt:DateTimeString>`;
const amount = (n: number) => n.toFixed(2);

function address(a: PostalAddress): string {
  return wrap("ram:PostalTradeAddress", [
    el("ram:PostcodeCode", a.postCode), // BT-38 / BT-53
    el("ram:LineOne", a.line1), // BT-35 / BT-50
    el("ram:LineTwo", a.line2), // BT-36 / BT-51
    el("ram:LineThree", a.line3), // BT-162 / BT-163
    el("ram:CityName", a.city), // BT-37 / BT-52
    el("ram:CountryID", a.country), // BT-40 / BT-55  (mandatory)
    el("ram:CountrySubDivisionName", a.subdivision), // BT-39 / BT-54
  ]);
}

function sellerParty(s: Seller): string {
  return wrap("ram:SellerTradeParty", [
    el("ram:Name", s.name), // BT-27
    wrap("ram:SpecifiedLegalOrganization", [
      el("ram:ID", s.legalRegistrationId), // BT-30
      el("ram:TradingBusinessName", s.tradingName), // BT-28
    ]),
    contact(s.contact),
    address(s.address),
    s.electronicAddress
      ? wrap("ram:URIUniversalCommunication", [
          el("ram:URIID", s.electronicAddress, { schemeID: "EM" }), // BT-34
        ])
      : "",
    s.vatId
      ? wrap("ram:SpecifiedTaxRegistration", [el("ram:ID", s.vatId, { schemeID: "VA" })]) // BT-31
      : "",
    s.taxNumber
      ? wrap("ram:SpecifiedTaxRegistration", [el("ram:ID", s.taxNumber, { schemeID: "FC" })]) // BT-32
      : "",
  ]);
}

function buyerParty(b: Buyer): string {
  return wrap("ram:BuyerTradeParty", [
    el("ram:Name", b.name), // BT-44
    wrap("ram:SpecifiedLegalOrganization", [
      el("ram:ID", b.legalRegistrationId), // BT-47
      el("ram:TradingBusinessName", b.tradingName), // BT-45
    ]),
    contact(b.contact),
    address(b.address),
    b.electronicAddress
      ? wrap("ram:URIUniversalCommunication", [
          el("ram:URIID", b.electronicAddress, { schemeID: "EM" }), // BT-49
        ])
      : "",
    b.vatId
      ? wrap("ram:SpecifiedTaxRegistration", [el("ram:ID", b.vatId, { schemeID: "VA" })]) // BT-48
      : "",
  ]);
}

function contact(c: { name?: string; phone?: string; email?: string } | undefined): string {
  if (!c) return "";
  return wrap("ram:DefinedTradeContact", [
    el("ram:PersonName", c.name), // BT-41 / BT-56
    c.phone
      ? wrap("ram:TelephoneUniversalCommunication", [el("ram:CompleteNumber", c.phone)]) // BT-42 / BT-57
      : "",
    c.email
      ? wrap("ram:EmailURIUniversalCommunication", [el("ram:URIID", c.email)]) // BT-43 / BT-58
      : "",
  ]);
}

/** A document-level allowance/charge (BG-20 / BG-21). `ChargeIndicator` distinguishes the two. */
function docAllowanceCharge(ac: AllowanceCharge): string {
  return wrap("ram:SpecifiedTradeAllowanceCharge", [
    wrap("ram:ChargeIndicator", [el("udt:Indicator", String(ac.isCharge))]),
    el("ram:ActualAmount", amount(ac.amount)), // BT-92 / BT-99
    el("ram:Reason", ac.reason), // BT-97 / BT-104
    el("ram:ReasonCode", ac.reasonCode), // BT-98 / BT-105
    wrap("ram:CategoryTradeTax", [
      el("ram:TypeCode", "VAT"),
      el("ram:CategoryCode", ac.vat.category), // BT-95 / BT-102
      el("ram:RateApplicablePercent", ac.vat.ratePercent ?? 0), // BT-96 / BT-103
    ]),
  ]);
}

/** One VAT breakdown group (BG-23). */
function tradeTax(g: VatBreakdownEntry): string {
  return wrap("ram:ApplicableTradeTax", [
    el("ram:CalculatedAmount", amount(g.taxAmount)), // BT-117
    el("ram:TypeCode", "VAT"),
    el("ram:ExemptionReason", g.exemption?.text), // BT-120
    el("ram:BasisAmount", amount(g.taxableAmount)), // BT-116
    el("ram:CategoryCode", g.category), // BT-118
    el("ram:ExemptionReasonCode", g.exemption?.code), // BT-121
    el("ram:RateApplicablePercent", g.ratePercent), // BT-119
  ]);
}

/** One invoice line (BG-25). `net` is the pre-computed line net amount (BT-131). */
function line(l: InvoiceLine, net: number, index: number): string {
  return wrap("ram:IncludedSupplyChainTradeLineItem", [
    wrap("ram:AssociatedDocumentLineDocument", [
      el("ram:LineID", l.id ?? String(index + 1)), // BT-126
      l.note ? wrap("ram:IncludedNote", [el("ram:Content", l.note)]) : "", // BT-127
    ]),
    wrap("ram:SpecifiedTradeProduct", [
      el("ram:SellerAssignedID", l.sellerItemId), // BT-155
      el("ram:BuyerAssignedID", l.buyerItemId), // BT-156
      l.standardItemId
        ? el("ram:GlobalID", l.standardItemId, { schemeID: "0160" }) // BT-157 (GTIN)
        : "",
      el("ram:Name", l.name), // BT-153
      el("ram:Description", l.description), // BT-154
    ]),
    wrap("ram:SpecifiedLineTradeAgreement", [
      wrap("ram:NetPriceProductTradePrice", [
        el("ram:ChargeAmount", amount(l.netUnitPrice)), // BT-146
        l.priceBaseQuantity
          ? el("ram:BasisQuantity", l.priceBaseQuantity, { unitCode: l.unit }) // BT-149 / BT-150
          : "",
      ]),
    ]),
    wrap("ram:SpecifiedLineTradeDelivery", [
      el("ram:BilledQuantity", l.quantity, { unitCode: l.unit }), // BT-129 / BT-130
    ]),
    wrap("ram:SpecifiedLineTradeSettlement", [
      wrap("ram:ApplicableTradeTax", [
        el("ram:TypeCode", "VAT"),
        el("ram:CategoryCode", l.vat.category), // BT-151
        el("ram:RateApplicablePercent", l.vat.ratePercent ?? 0), // BT-152
      ]),
      wrap("ram:SpecifiedTradeSettlementLineMonetarySummation", [
        el("ram:LineTotalAmount", amount(net)), // BT-131
      ]),
    ]),
  ]);
}

export function toCII(
  invoice: Invoice,
  computed: ComputedInvoice,
  profile: CiiProfile = "en16931",
): string {
  const notes = (invoice.notes ?? []).map((n) => wrap("ram:IncludedNote", [el("ram:Content", n)])); // BG-1 / BT-22

  const header = wrap("rsm:ExchangedDocument", [
    el("ram:ID", invoice.number), // BT-1
    el("ram:TypeCode", invoice.type ?? 380), // BT-3
    wrap("ram:IssueDateTime", [date102(invoice.issueDate)]), // BT-2
    ...notes,
  ]);

  const lines = invoice.lines.map((l, i) => line(l, computed.lineNets[i], i)); // BG-25

  const agreement = wrap("ram:ApplicableHeaderTradeAgreement", [
    el("ram:BuyerReference", invoice.buyerReference), // BT-10 (Leitweg-ID for XRechnung)
    sellerParty(invoice.seller), // BG-4
    buyerParty(invoice.buyer), // BG-7
    invoice.purchaseOrderRef
      ? wrap("ram:BuyerOrderReferencedDocument", [
          el("ram:IssuerAssignedID", invoice.purchaseOrderRef), // BT-13
        ])
      : "",
    invoice.contractRef
      ? wrap("ram:ContractReferencedDocument", [
          el("ram:IssuerAssignedID", invoice.contractRef), // BT-12
        ])
      : "",
  ]);

  const d = invoice.delivery;
  // ApplicableHeaderTradeDelivery is mandatory (1..1) even when empty — emit the wrapper always.
  const deliveryChildren = [
    d?.recipientName || d?.address
      ? wrap("ram:ShipToTradeParty", [
          el("ram:Name", d?.recipientName), // BT-70
          d?.address ? address(d.address) : "", // BG-15
        ])
      : "",
    d?.date
      ? wrap("ram:ActualDeliverySupplyChainEvent", [
          wrap("ram:OccurrenceDateTime", [date102(d.date)]), // BT-72
        ])
      : "",
  ]
    .filter(Boolean)
    .join("");
  const delivery = `<ram:ApplicableHeaderTradeDelivery>${deliveryChildren}</ram:ApplicableHeaderTradeDelivery>`;

  const p = invoice.payment;
  const paymentMeans =
    p && (p.iban || p.meansCode)
      ? wrap("ram:SpecifiedTradeSettlementPaymentMeans", [
          el("ram:TypeCode", p.meansCode ?? "58"), // BT-81 (58 = SEPA credit transfer)
          el("ram:Information", p.meansText), // BT-82
          p.iban
            ? wrap("ram:PayeePartyCreditorFinancialAccount", [
                el("ram:IBANID", p.iban), // BT-84
                el("ram:AccountName", p.accountName), // BT-85
              ])
            : "",
          p.bic
            ? wrap("ram:PayeeSpecifiedCreditorFinancialInstitution", [
                el("ram:BICID", p.bic), // BT-86
              ])
            : "",
        ])
      : "";

  const paymentTerms =
    invoice.dueDate || p?.terms
      ? wrap("ram:SpecifiedTradePaymentTerms", [
          el("ram:Description", p?.terms), // BT-20
          invoice.dueDate
            ? wrap("ram:DueDateDateTime", [date102(invoice.dueDate)]) // BT-9
            : "",
        ])
      : "";

  const totals = wrap("ram:SpecifiedTradeSettlementHeaderMonetarySummation", [
    el("ram:LineTotalAmount", amount(computed.lineTotal)), // BT-106
    invoice.allowancesCharges?.some((a) => !a.isCharge)
      ? el("ram:AllowanceTotalAmount", amount(computed.allowanceTotal)) // BT-107
      : "",
    invoice.allowancesCharges?.some((a) => a.isCharge)
      ? el("ram:ChargeTotalAmount", amount(computed.chargeTotal)) // BT-108
      : "",
    el("ram:TaxBasisTotalAmount", amount(computed.taxBasisTotal)), // BT-109
    el("ram:TaxTotalAmount", amount(computed.taxTotal), { currencyID: invoice.currency }), // BT-110
    el("ram:GrandTotalAmount", amount(computed.grandTotal)), // BT-112
    computed.paidAmount ? el("ram:TotalPrepaidAmount", amount(computed.paidAmount)) : "", // BT-113
    el("ram:DuePayableAmount", amount(computed.duePayable)), // BT-115
  ]);

  const settlement = wrap("ram:ApplicableHeaderTradeSettlement", [
    invoice.payeeName ? wrap("ram:PayeeTradeParty", [el("ram:Name", invoice.payeeName)]) : "", // BG-10
    el("ram:InvoiceCurrencyCode", invoice.currency), // BT-5
    paymentMeans, // BG-16
    ...computed.vatBreakdown.map(tradeTax), // BG-23
    ...(invoice.allowancesCharges ?? []).map(docAllowanceCharge), // BG-20 / BG-21
    paymentTerms,
    totals, // BG-22
  ]);

  const transaction = wrap("rsm:SupplyChainTradeTransaction", [
    ...lines,
    agreement,
    delivery,
    settlement,
  ]);

  const context = wrap("rsm:ExchangedDocumentContext", [
    // BusinessProcess (BT-23) precedes Guideline in the CII sequence; XRechnung requires it.
    profile === "xrechnung"
      ? wrap("ram:BusinessProcessSpecifiedDocumentContextParameter", [
          el("ram:ID", BUSINESS_PROCESS), // BT-23
        ])
      : "",
    wrap("ram:GuidelineSpecifiedDocumentContextParameter", [el("ram:ID", GUIDELINE[profile])]), // BT-24
  ]);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:udt="${NS.udt}">` +
    context +
    header +
    transaction +
    `</rsm:CrossIndustryInvoice>`
  );
}
