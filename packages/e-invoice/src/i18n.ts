// Invoice-template localisation: the visible LABELS (template chrome) plus locale-aware number,
// currency and date formatting. The invoice DATA (names, item texts, addresses) is never translated -
// it stays in whatever language the user supplied. Formatting uses the built-in `Intl` API (ECMA-402,
// no dependency). Default locale is `de` (ZUGFeRD is a German standard / German-market-first).

export type Locale = "de" | "en" | "fr";

/** Every label the default template draws. A custom language = supply a full `InvoiceLabels`. */
export interface InvoiceLabels {
  invoice: string;
  creditNote: string;
  position: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
  amount: string;
  subtotal: string;
  allowance: string;
  charge: string;
  netTotal: string;
  plusVat: string;
  grandTotal: string;
  alreadyPaid: string;
  amountDue: string;
  payment: string;
  payableBy: string;
  bankDetails: string;
  remittance: string;
  invoiceNumber: string;
  invoiceDate: string;
  deliveryDate: string;
  servicePeriod: string;
  dueDate: string;
  customerReference: string;
  orderNumber: string;
  contractReference: string;
  buyerVatId: string;
  deliverTo: string;
  payee: string;
  paymentMeans: string;
  itemNumber: string;
  perQuantity: string;
  page: string;
  pageOf: string;
  contactPerson: string;
  email: string;
  vatBreakdown: string;
  taxableBase: string;
  taxAmount: string;
  amountsIn: string;
  vatId: string;
  taxNumber: string;
  registration: string;
  phone: string;
}

const de: InvoiceLabels = {
  invoice: "Rechnung",
  creditNote: "Gutschrift",
  position: "Pos",
  description: "Beschreibung",
  quantity: "Menge",
  unitPrice: "Einzelpreis",
  vat: "USt",
  amount: "Betrag",
  subtotal: "Summe Positionen",
  allowance: "abzgl. Nachlass",
  charge: "zzgl. Zuschlag",
  netTotal: "Nettobetrag",
  plusVat: "zzgl. USt",
  grandTotal: "Gesamtbetrag",
  alreadyPaid: "bereits gezahlt",
  amountDue: "Zahlbetrag",
  payment: "Zahlung",
  payableBy: "Zahlbar bis",
  bankDetails: "Bankverbindung",
  remittance: "Verwendungszweck",
  invoiceNumber: "Rechnungsnummer",
  invoiceDate: "Rechnungsdatum",
  deliveryDate: "Lieferdatum",
  servicePeriod: "Leistungszeitraum",
  dueDate: "Fälligkeit",
  customerReference: "Kundenreferenz",
  orderNumber: "Bestellnummer",
  contractReference: "Vertragsnummer",
  buyerVatId: "USt-IdNr. Kunde",
  deliverTo: "Lieferanschrift",
  payee: "Zahlungsempfänger",
  paymentMeans: "Zahlungsart",
  itemNumber: "Art.-Nr.",
  perQuantity: "je",
  page: "Seite",
  pageOf: "von",
  contactPerson: "Ansprechpartner",
  email: "E-Mail",
  vatBreakdown: "Steueraufschlüsselung",
  taxableBase: "Netto",
  taxAmount: "Steuer",
  amountsIn: "Alle Beträge in",
  vatId: "USt-IdNr",
  taxNumber: "Steuernr",
  registration: "Reg.",
  phone: "Tel.",
};

const en: InvoiceLabels = {
  invoice: "Invoice",
  creditNote: "Credit note",
  position: "No.",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  vat: "VAT",
  amount: "Amount",
  subtotal: "Subtotal",
  allowance: "less discount",
  charge: "plus surcharge",
  netTotal: "Net amount",
  plusVat: "plus VAT",
  grandTotal: "Total",
  alreadyPaid: "already paid",
  amountDue: "Amount due",
  payment: "Payment",
  payableBy: "Payable by",
  bankDetails: "Bank details",
  remittance: "Reference",
  invoiceNumber: "Invoice no.",
  invoiceDate: "Invoice date",
  deliveryDate: "Delivery date",
  servicePeriod: "Service period",
  dueDate: "Due date",
  customerReference: "Customer reference",
  orderNumber: "Order no.",
  contractReference: "Contract reference",
  buyerVatId: "Buyer VAT ID",
  deliverTo: "Delivery address",
  payee: "Payee",
  paymentMeans: "Payment method",
  itemNumber: "Item no.",
  perQuantity: "per",
  page: "Page",
  pageOf: "of",
  contactPerson: "Contact",
  email: "Email",
  vatBreakdown: "VAT breakdown",
  taxableBase: "Net",
  taxAmount: "Tax",
  amountsIn: "All amounts in",
  vatId: "VAT ID",
  taxNumber: "Tax no.",
  registration: "Reg.",
  phone: "Tel.",
};

const fr: InvoiceLabels = {
  invoice: "Facture",
  creditNote: "Avoir",
  position: "N°",
  description: "Description",
  quantity: "Qté",
  unitPrice: "Prix unitaire",
  vat: "TVA",
  amount: "Montant",
  subtotal: "Sous-total",
  allowance: "remise",
  charge: "majoration",
  netTotal: "Total HT",
  plusVat: "TVA",
  grandTotal: "Total TTC",
  alreadyPaid: "déjà payé",
  amountDue: "Net à payer",
  payment: "Paiement",
  payableBy: "À payer avant le",
  bankDetails: "Coordonnées bancaires",
  remittance: "Référence",
  invoiceNumber: "N° de facture",
  invoiceDate: "Date de facture",
  deliveryDate: "Date de livraison",
  servicePeriod: "Période de prestation",
  dueDate: "Échéance",
  customerReference: "Référence client",
  orderNumber: "N° de commande",
  contractReference: "Référence du contrat",
  buyerVatId: "N° TVA client",
  deliverTo: "Adresse de livraison",
  payee: "Bénéficiaire",
  paymentMeans: "Mode de paiement",
  itemNumber: "Réf. article",
  perQuantity: "par",
  page: "Page",
  pageOf: "sur",
  contactPerson: "Interlocuteur",
  email: "E-mail",
  vatBreakdown: "Détail de la TVA",
  taxableBase: "Net",
  taxAmount: "Taxe",
  amountsIn: "Tous les montants en",
  vatId: "N° TVA",
  taxNumber: "N° fiscal",
  registration: "Immatriculation",
  phone: "Tél.",
};

const DICTIONARIES: Record<Locale, InvoiceLabels> = { de, en, fr };
const LOCALE_TAG: Record<Locale, string> = { de: "de-DE", en: "en-US", fr: "fr-FR" };

/** The label set for a locale, with optional per-key overrides merged on top. */
export function resolveLabels(
  locale: Locale = "de",
  overrides?: Partial<InvoiceLabels>,
): InvoiceLabels {
  return { ...DICTIONARIES[locale], ...overrides };
}

/** Locale-aware formatters for the amounts, percentages and dates the template prints. */
export interface Formatters {
  /** A currency amount, e.g. de → "1.234,56 €", en → "€1,234.56". */
  money(n: number): string;
  /** A plain number, e.g. a quantity. */
  number(n: number): string;
  /** A VAT rate given in percent (19 → de "19 %", en "19%"). */
  percent(ratePercent: number): string;
  /** An ISO date "YYYY-MM-DD" in the locale's short form (UTC, so no timezone drift). */
  date(iso: string): string;
  /** The currency spelled out in the invoice language, e.g. "Euro" - BT-5 as a word, not a code. */
  currencyName(): string;
  /**
   * A service period (BG-14/BG-26) for the eye. One covering exactly one whole calendar month reads
   * AS that month ("Juni 2026") - the form §31 Abs. 4 UStDV allows in place of a day. The XML is
   * untouched and keeps both ends, which is what BT-73/BT-74 require.
   */
  period(start: string, end: string): string;
}

export function makeFormatters(locale: Locale = "de", currency: string): Formatters {
  const tag = LOCALE_TAG[locale];
  const money = new Intl.NumberFormat(tag, { style: "currency", currency });
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
  const month = new Intl.DateTimeFormat(tag, { year: "numeric", month: "long", timeZone: "UTC" });
  const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
  // Intl knows the names in every locale; a table of our own would be one more thing to keep right.
  const currencyNames = new Intl.DisplayNames([tag], { type: "currency" });
  return {
    money: (n) => money.format(n),
    number: (n) => number.format(n),
    percent: (ratePercent) => percent.format(ratePercent / 100),
    date: (iso) => date.format(utc(iso)),
    currencyName: () => currencyNames.of(currency) ?? currency,
    period: (start, end) =>
      wholeMonth(start, end)
        ? month.format(utc(start))
        : `${date.format(utc(start))} - ${date.format(utc(end))}`,
  };
}

/** Whether a period is exactly one calendar month, start to end - the case that reads as "Juni 2026". */
function wholeMonth(start: string, end: string): boolean {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  // Day 0 of the FOLLOWING month is the last day of this one; `endMonth` is 1-based, so as a 0-based
  // index it already names the following month.
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return startYear === endYear && startMonth === endMonth && startDay === 1 && endDay === lastDay;
}
