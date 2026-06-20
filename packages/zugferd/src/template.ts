import {
  Box,
  Column,
  Divider,
  Document,
  Expanded,
  Page,
  type PDFDocumentElement,
  type PDFElement,
  Row,
  Spacer,
  Table,
  Text,
} from "@jasy/pdf";
import { Invoice, PostalAddress, Seller } from "./invoice";
import { ComputedInvoice, VatBreakdownEntry } from "./compute";
import { Formatters, InvoiceLabels } from "./i18n";

// The built-in invoice layout: a complete, §14-UStG-aware invoice that renders EVERYTHING the
// Invoice carries (legal mandatory fields + bank details + payment reference + legal footer), not
// just a pretty subset. All visible chrome comes from `labels`, all amounts/dates from `fmt` (locale)
// - the invoice DATA stays in the user's language. The recipient block sits where a DIN-5008 window
// envelope expects it. Override the whole layout via `renderZugferd(invoice, { pdf })`.

const BRAND = "#1a4f8a";
const INK = "#1f2933";
const MUTED = "#7b8794";
const HAIR = "#d8dee6";
const PANEL = "#f5f8fc";

/** Address as display lines (street, "12345 City", country). */
function addressLines(a: PostalAddress): string[] {
  return [
    a.line1,
    a.line2,
    a.line3,
    [a.postCode, a.city].filter(Boolean).join(" "),
    a.subdivision,
    a.country,
  ].filter((s): s is string => Boolean(s && s.trim()));
}

export function defaultInvoiceTemplate(
  invoice: Invoice,
  c: ComputedInvoice,
  L: InvoiceLabels,
  fmt: Formatters,
): PDFDocumentElement {
  const { seller } = invoice;

  // A label/value line right-aligned into a fixed value column (totals).
  const valueLine = (label: string, value: string, o: { strong?: boolean; size?: number } = {}) =>
    Row({ align: "start" }, [
      Expanded({ flex: 1 }, Text(label, { size: o.size ?? 9.5, color: MUTED, align: "right" })),
      Box({ width: 92 }, [
        Text(value, { size: o.size ?? 9.5, color: INK, bold: o.strong, align: "right" }),
      ]),
    ]);

  return Document([
    Page(
      {
        size: "A4",
        margin: 48,
        gap: 16,
        // header (letterhead) + legal footer are page bands → they repeat on every physical page.
        header: Column({ gap: 8 }, [sellerHeader(seller, L), Divider({ color: HAIR })]),
        footer: legalFooter(seller, L),
      },
      [
        recipientAndMeta(invoice, L, fmt),
        Text(`${L.invoice} ${invoice.number}`, { size: 21, bold: true, color: INK }),
        ...notes(invoice),
        lineItemsTable(invoice, c, L, fmt),
        totals(c, L, fmt, valueLine),
        paymentPanel(invoice, L, fmt),
      ],
    ),
  ]);
}

// --- header: seller name (left) + compact contact (right) ---
function sellerHeader(seller: Seller, L: InvoiceLabels): PDFElement {
  const contact = [
    ...addressLines(seller.address),
    seller.contact?.phone && `${L.phone} ${seller.contact.phone}`,
    seller.contact?.email,
  ].filter((s): s is string => Boolean(s));

  return Row({ align: "start" }, [
    Column({ gap: 1 }, [
      Text(seller.name, { size: 18, bold: true, color: BRAND }),
      ...(seller.tradingName ? [Text(seller.tradingName, { size: 10, color: MUTED })] : []),
    ]),
    Spacer(),
    Box({ width: 220 }, [
      Column(
        { gap: 1 },
        contact.map((l) => Text(l, { size: 9, color: MUTED, align: "right" })),
      ),
    ]),
  ]);
}

// --- recipient address (left, window-envelope position) + invoice meta (right) ---
function recipientAndMeta(invoice: Invoice, L: InvoiceLabels, fmt: Formatters): PDFElement {
  const { seller, buyer } = invoice;
  const returnLine = [seller.name, ...addressLines(seller.address)].join(" · ");

  const recipient = Column({ gap: 1 }, [
    Text(returnLine, { size: 7, color: MUTED }),
    Box({ height: 6 }, []),
    Text(buyer.name, { size: 11, bold: true, color: INK }),
    ...(buyer.tradingName ? [Text(buyer.tradingName, { size: 10, color: INK })] : []),
    ...addressLines(buyer.address).map((l) => Text(l, { size: 10, color: INK })),
  ]);

  const meta: [string, string | undefined][] = [
    [L.invoiceNumber, invoice.number],
    [L.invoiceDate, fmt.date(invoice.issueDate)],
    [L.deliveryDate, invoice.delivery?.date ? fmt.date(invoice.delivery.date) : undefined],
    [L.dueDate, invoice.dueDate ? fmt.date(invoice.dueDate) : undefined],
    [L.customerReference, invoice.buyerReference],
    [L.orderNumber, invoice.purchaseOrderRef],
  ];
  const metaBox = Box({ bg: PANEL, padding: { x: 12, y: 10 }, radius: 4, width: 210 }, [
    Column(
      { gap: 3 },
      meta
        .filter((m): m is [string, string] => Boolean(m[1]))
        .map(([label, value]) =>
          Row({}, [
            Expanded({ flex: 1 }, Text(label, { size: 9, color: MUTED })),
            Text(value, { size: 9, color: INK, bold: true, align: "right" }),
          ]),
        ),
    ),
  ]);

  return Row({ align: "start" }, [Expanded({ flex: 1 }, recipient), metaBox]);
}

function notes(invoice: Invoice): PDFElement[] {
  if (!invoice.notes?.length) return [];
  return invoice.notes.map((n) => Text(n, { size: 10, color: INK }));
}

// --- line items: No | Description | Qty | Unit price | VAT | Amount ---
function lineItemsTable(
  invoice: Invoice,
  c: ComputedInvoice,
  L: InvoiceLabels,
  fmt: Formatters,
): PDFElement {
  const right = (s: string, bold = false) => Text(s, { size: 9.5, align: "right", bold });
  const head = (s: string, align: "left" | "right" = "left") =>
    Text(s, { size: 9, bold: true, color: BRAND, align });

  const rows = invoice.lines.map((line, i) => {
    const descr = Column({ gap: 1 }, [
      Text(line.name, { size: 9.5, color: INK }),
      ...(line.description ? [Text(line.description, { size: 8, color: MUTED })] : []),
    ]);
    return [
      Text(line.id ?? String(i + 1), { size: 9.5, color: MUTED }),
      descr,
      right(`${fmt.number(line.quantity)} ${line.unit}`),
      right(fmt.money(line.netUnitPrice)),
      right(fmt.percent(line.vat.ratePercent ?? 0)),
      right(fmt.money(c.lineNets[i]), true),
    ];
  });

  return Table(
    {
      columns: [40, "1fr", 70, 80, 50, 84],
      header: [
        head(L.position),
        head(L.description),
        head(L.quantity, "right"),
        head(L.unitPrice, "right"),
        head(L.vat, "right"),
        head(L.amount, "right"),
      ],
      cellBorder: HAIR,
      cellPadding: { x: 6, y: 5 },
    },
    rows,
  );
}

// --- totals + VAT breakdown, right-aligned ---
function totals(
  c: ComputedInvoice,
  L: InvoiceLabels,
  fmt: Formatters,
  valueLine: (l: string, v: string, o?: { strong?: boolean; size?: number }) => PDFElement,
): PDFElement {
  const lines: PDFElement[] = [];
  const hasDocAC = c.allowanceTotal > 0 || c.chargeTotal > 0;

  if (hasDocAC) {
    lines.push(valueLine(L.subtotal, fmt.money(c.lineTotal)));
    if (c.allowanceTotal > 0) lines.push(valueLine(L.allowance, `-${fmt.money(c.allowanceTotal)}`));
    if (c.chargeTotal > 0) lines.push(valueLine(L.charge, fmt.money(c.chargeTotal)));
  }
  lines.push(valueLine(L.netTotal, fmt.money(c.taxBasisTotal)));

  for (const v of c.vatBreakdown)
    lines.push(valueLine(vatLabel(v, L, fmt), fmt.money(v.taxAmount)));

  lines.push(Divider({ color: HAIR, margin: { y: 2 } }));
  lines.push(valueLine(L.grandTotal, fmt.money(c.grandTotal), { strong: true, size: 11 }));
  if (c.paidAmount > 0) lines.push(valueLine(L.alreadyPaid, `-${fmt.money(c.paidAmount)}`));
  lines.push(valueLine(L.amountDue, fmt.money(c.duePayable), { strong: true, size: 12 }));

  const exemptions = c.vatBreakdown
    .filter((v) => v.exemption?.text)
    .map((v) => Text(`${v.category}: ${v.exemption!.text}`, { size: 8, color: MUTED }));

  return Row({ align: "start" }, [
    Expanded({ flex: 1 }, Column({ gap: 2 }, exemptions)),
    Box({ width: 250 }, [Column({ gap: 3 }, lines)]),
  ]);
}

function vatLabel(v: VatBreakdownEntry, L: InvoiceLabels, fmt: Formatters): string {
  if (v.category === "S") return `${L.plusVat} ${fmt.percent(v.ratePercent)}`;
  return `${L.vat} ${fmt.percent(v.ratePercent)} (${v.category})`;
}

// --- payment terms + bank details + remittance reference ---
function paymentPanel(invoice: Invoice, L: InvoiceLabels, fmt: Formatters): PDFElement {
  const p = invoice.payment;
  const reference = p?.reference ?? invoice.number;
  const left: PDFElement[] = [
    Text(L.payment, { size: 10, bold: true, color: INK }),
    ...(invoice.dueDate
      ? [Text(`${L.payableBy} ${fmt.date(invoice.dueDate)}`, { size: 9, color: INK })]
      : []),
    ...(p?.terms ? [Text(p.terms, { size: 9, color: MUTED })] : []),
  ];
  const right: PDFElement[] = [
    Text(L.bankDetails, { size: 10, bold: true, color: INK }),
    ...(p?.accountName ? [Text(p.accountName, { size: 9, color: INK })] : []),
    ...(p?.iban ? [Text(`IBAN  ${p.iban}`, { size: 9, color: INK })] : []),
    ...(p?.bic ? [Text(`BIC  ${p.bic}`, { size: 9, color: INK })] : []),
    Text(`${L.remittance}  ${reference}`, { size: 9, color: MUTED }),
  ];

  return Box({ bg: PANEL, padding: { x: 14, y: 12 }, radius: 4 }, [
    Row({ gap: 24, align: "start" }, [
      Expanded({ flex: 1 }, Column({ gap: 2 }, left)),
      Expanded({ flex: 1 }, Column({ gap: 2 }, right)),
    ]),
  ]);
}

// --- legal footer band: identity + tax ids + register + bank ---
function legalFooter(seller: Seller, L: InvoiceLabels): PDFElement {
  const col = (items: (string | false | undefined)[]) =>
    Expanded(
      { flex: 1 },
      Column(
        { gap: 1 },
        items
          .filter((s): s is string => Boolean(s))
          .map((s) => Text(s, { size: 7.5, color: MUTED })),
      ),
    );

  return Column({ gap: 4 }, [
    Divider({ color: HAIR }),
    Row({ gap: 16, align: "start" }, [
      col([seller.name, ...addressLines(seller.address)]),
      col([
        seller.vatId && `${L.vatId} ${seller.vatId}`,
        seller.taxNumber && `${L.taxNumber} ${seller.taxNumber}`,
        seller.legalRegistrationId && `${L.registration} ${seller.legalRegistrationId}`,
        seller.additionalLegalInfo,
      ]),
      col([
        seller.contact?.phone && `${L.phone} ${seller.contact.phone}`,
        seller.contact?.email,
        seller.electronicAddress,
      ]),
    ]),
  ]);
}
