import {
  Box,
  Column,
  Divider,
  Document,
  PageBuilder,
  Expanded,
  Page,
  type PDFDocumentElement,
  type PDFElement,
  Row,
  Table,
  Text,
} from "@jasy/pdf";
import { Delivery, Invoice, PostalAddress, Seller } from "./invoice.ts";
import { ComputedInvoice, VatBreakdownEntry } from "./compute.ts";
import { Formatters, InvoiceLabels } from "./i18n.ts";

// The built-in invoice layout: a complete, §14-UStG-aware invoice that renders everything the
// Invoice carries. That is not a promise in prose - `tests/completeness.test.ts` sets EVERY field to
// a marker and insists each one reaches the page, and the handful left off are listed there with a
// reason. It matters because a ZUGFeRD file has two halves: a value that reaches the XML and not the
// paper makes the document contradict itself, and no validator checks that. All visible chrome comes from `labels`, all amounts/dates from `fmt` (locale)
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
        footer: legalFooter(invoice, L),
      },
      [
        recipientAndMeta(invoice, L, fmt),
        Text(documentTitle(invoice, L), { size: 21, bold: true, color: INK }),
        ...deliverTo(invoice.delivery, L),
        ...notes(invoice),
        lineItemsTable(invoice, c, L, fmt),
        totals(invoice, c, L, fmt, valueLine),
        paymentPanel(invoice, L, fmt),
      ],
    ),
  ]);
}

// --- header: seller name (left) + compact contact (right) ---
function sellerHeader(seller: Seller, L: InvoiceLabels): PDFElement {
  const contact = [
    ...addressLines(seller.address),
    seller.contact?.name,
    seller.contact?.phone && `${L.phone} ${seller.contact.phone}`,
    seller.contact?.email,
  ].filter((s): s is string => Boolean(s));

  // The name is Expanded, NOT shrink-wrapped: a long company name would otherwise take its natural
  // single-line width and push the contact block clean off the page, where the viewer clips it.
  return Row({ align: "start", gap: 16 }, [
    Expanded(
      { flex: 1 },
      Column({ gap: 1 }, [
        Text(seller.name, { size: 18, bold: true, color: BRAND }),
        ...(seller.tradingName ? [Text(seller.tradingName, { size: 10, color: MUTED })] : []),
      ]),
    ),
    Box({ width: 220 }, [
      Column(
        { gap: 1 },
        contact.map((l) => Text(l, { size: 9, color: MUTED, align: "right" })),
      ),
    ]),
  ]);
}

/** A deliver-to party/address (BT-70 / BG-15) when goods go somewhere other than the buyer. */
function deliverTo(delivery: Delivery | undefined, L: InvoiceLabels): PDFElement[] {
  const lines = [
    delivery?.recipientName,
    ...(delivery?.address ? addressLines(delivery.address) : []),
  ].filter((s): s is string => Boolean(s));

  // ONE element, not loose lines: the page flow has a 16pt gap and would space the address apart.
  return lines.length === 0
    ? []
    : [
        Column({ gap: 1 }, [
          Text(L.deliverTo, { size: 8, bold: true, color: MUTED }),
          ...lines.map((l) => Text(l, { size: 9, color: INK })),
        ]),
      ];
}

/**
 * One label/value line of the information block.
 *
 * A long value gets its OWN line. Side by side it would take its natural single-line width and run
 * back over the label - and a real invoice number like "INV-MRHG2EXG-2026/012-SD" carries no space,
 * so no line breaker can help: there is nowhere to break. Stacking gives it the full panel width.
 */
function metaRow(label: string, value: string): PDFElement {
  if (value.length > 18) {
    return Column({ gap: 0 }, [
      Text(label, { size: 9, color: MUTED }),
      Text(value, { size: 9, color: INK, bold: true, align: "right" }),
    ]);
  }
  return Row({ gap: 6, align: "start" }, [
    Expanded({ flex: 1 }, Text(label, { size: 9, color: MUTED })),
    Text(value, { size: 9, color: INK, bold: true, align: "right" }),
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
    [
      L.servicePeriod,
      invoice.period ? fmt.period(invoice.period.start, invoice.period.end) : undefined,
    ],
    [L.deliveryDate, invoice.delivery?.date ? fmt.date(invoice.delivery.date) : undefined],
    [L.dueDate, invoice.dueDate ? fmt.date(invoice.dueDate) : undefined],
    [L.customerReference, invoice.buyerReference],
    [L.orderNumber, invoice.purchaseOrderRef],
    [L.contractReference, invoice.contractRef],
    // BT-48 belongs on the paper (§14a Abs. 1 UStG for reverse charge), but NOT under the address:
    // that block shows through a DIN 5008 window, which may hold nothing but the postal address.
    [L.buyerVatId, buyer.vatId],
    [L.registration, buyer.legalRegistrationId],
    [L.contactPerson, buyer.contact?.name],
    [L.phone, buyer.contact?.phone],
    [L.email, buyer.contact?.email],
  ];
  const metaBox = Box({ bg: PANEL, padding: { x: 12, y: 10 }, radius: 4, width: 210 }, [
    Column(
      { gap: 3 },
      meta
        .filter((m): m is [string, string] => Boolean(m[1]))
        .map(([label, value]) => metaRow(label, value)),
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
    const itemIds = [line.sellerItemId, line.buyerItemId, line.standardItemId]
      .filter((s): s is string => Boolean(s))
      .join(" · ");
    // BT-97/BT-104: a discount has to say WHY. §14 Abs. 4 Nr. 7 wants an agreed reduction named.
    const lineAdjustments = (line.allowancesCharges ?? []).map(
      (ac) =>
        `${ac.reason ?? (ac.isCharge ? L.charge : L.allowance)}  ${ac.isCharge ? "" : "-"}${fmt.money(ac.amount)}`,
    );
    const sub = (t: string) => Text(t, { size: 8, color: MUTED });

    // BG-26: the period THIS line covers, shown only when it says something the document period
    // does not - repeating an identical span on every row is noise, and the header already has it.
    const linePeriod =
      line.period &&
      (line.period.start !== invoice.period?.start || line.period.end !== invoice.period?.end)
        ? `${L.servicePeriod} ${fmt.period(line.period.start, line.period.end)}`
        : undefined;

    const descr = Column({ gap: 1 }, [
      Text(line.name, { size: 9.5, color: INK }),
      ...(line.description ? [sub(line.description)] : []),
      ...(linePeriod ? [sub(linePeriod)] : []),
      ...(itemIds ? [sub(`${L.itemNumber} ${itemIds}`)] : []),
      ...(line.note ? [sub(line.note)] : []), // BT-127
      ...lineAdjustments.map(sub),
    ]);
    return [
      Text(line.id ?? String(i + 1), { size: 9.5, color: MUTED }),
      descr,
      right(`${fmt.number(line.quantity)} ${line.unit}`),
      right(
        line.priceBaseQuantity && line.priceBaseQuantity !== 1
          ? `${fmt.money(line.netUnitPrice)} ${L.perQuantity} ${fmt.number(line.priceBaseQuantity)} ${line.unit}`
          : fmt.money(line.netUnitPrice),
      ),
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
  invoice: Invoice,
  c: ComputedInvoice,
  L: InvoiceLabels,
  fmt: Formatters,
  valueLine: (l: string, v: string, o?: { strong?: boolean; size?: number }) => PDFElement,
): PDFElement {
  const lines: PDFElement[] = [];
  const hasDocAC = c.allowanceTotal > 0 || c.chargeTotal > 0;

  if (hasDocAC) {
    lines.push(valueLine(L.subtotal, fmt.money(c.lineTotal)));
    // One line EACH, carrying its reason (BT-97 / BT-104). Two anonymous sums hid why money moved.
    for (const ac of invoice.allowancesCharges ?? []) {
      lines.push(
        valueLine(
          ac.reason ?? (ac.isCharge ? L.charge : L.allowance),
          `${ac.isCharge ? "" : "-"}${fmt.money(ac.amount)}`,
        ),
      );
    }
  }
  lines.push(valueLine(L.netTotal, fmt.money(c.taxBasisTotal)));

  if (hasVatBreakdown(c)) {
    lines.push(valueLine(L.vat, fmt.money(c.taxTotal)));
  } else {
    for (const v of c.vatBreakdown)
      lines.push(valueLine(vatLabel(v, L, fmt), fmt.money(v.taxAmount)));
  }

  lines.push(Divider({ color: HAIR, margin: { y: 2 } }));
  lines.push(valueLine(L.grandTotal, fmt.money(c.grandTotal), { strong: true, size: 11 }));
  if (c.paidAmount > 0) lines.push(valueLine(L.alreadyPaid, `-${fmt.money(c.paidAmount)}`));
  lines.push(valueLine(L.amountDue, fmt.money(c.duePayable), { strong: true, size: 12 }));
  lines.push(
    Text(`${L.amountsIn} ${fmt.currencyName()} (${invoice.currency})`, {
      size: 7.5,
      color: MUTED,
      align: "right",
    }),
  );

  return Row({ align: "start", gap: 16 }, [
    Expanded({ flex: 1 }, Column({ gap: 2 }, vatBreakdown(c, L, fmt))),
    Box({ width: 250 }, [Column({ gap: 3 }, lines)]),
  ]);
}

/**
 * The VAT breakdown (BG-23) as a block of its own, with each category's REASON directly beneath it.
 *
 * §14 Abs. 4 Nr. 8 UStG wants the rate and the tax amount on the entgelt; with two rates in play the
 * running totals column cannot show the taxable base per rate, only the tax. A single ordinary rate
 * needs none of this - the totals column already says everything - so the block appears only when it
 * carries information: several rates, or a category (AE/K/E/…) whose exemption reason must be read.
 */
function vatBreakdown(c: ComputedInvoice, L: InvoiceLabels, fmt: Formatters): PDFElement[] {
  const exemptions = c.vatBreakdown
    .filter((v) => v.exemption?.text)
    .map((v) => Text(`${v.category}: ${v.exemption!.text}`, { size: 8, color: MUTED }));

  if (!hasVatBreakdown(c)) return exemptions;

  const cell = (t: string, w: number, bold = false) =>
    Box({ width: w }, [Text(t, { size: 8.5, color: bold ? INK : MUTED, bold, align: "right" })]);
  const row = (label: string, base: string, tax: string, bold = false) =>
    Row({ gap: 8, align: "start" }, [
      Expanded({ flex: 1 }, Text(label, { size: 8.5, color: bold ? INK : MUTED, bold })),
      cell(base, 74, bold),
      cell(tax, 62, bold),
    ]);

  return [
    Column({ gap: 3 }, [
      Text(L.vatBreakdown, { size: 9, bold: true, color: INK }),
      row("", L.taxableBase, L.taxAmount),
      Divider({ color: HAIR }),
      ...c.vatBreakdown.map((v) =>
        row(vatLabel(v, L, fmt), fmt.money(v.taxableAmount), fmt.money(v.taxAmount), true),
      ),
      ...(exemptions.length > 0 ? [Box({ height: 2 }, []), ...exemptions] : []),
    ]),
  ];
}

/** Whether the breakdown earns its own block, rather than being said once in the totals column. */
function hasVatBreakdown(c: ComputedInvoice): boolean {
  return c.vatBreakdown.length > 1 || c.vatBreakdown.some((v) => v.category !== "S");
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
    ...(p?.meansText ? [Text(`${L.paymentMeans}  ${p.meansText}`, { size: 9, color: INK })] : []),
    ...(p?.terms ? [Text(p.terms, { size: 9, color: MUTED })] : []),
  ];
  const right: PDFElement[] = [
    Text(L.bankDetails, { size: 10, bold: true, color: INK }),
    ...(invoice.payeeName
      ? [Text(`${L.payee}  ${invoice.payeeName}`, { size: 9, color: INK })]
      : []),
    ...(p?.accountName ? [Text(p.accountName, { size: 9, color: INK })] : []),
    ...(p?.iban ? [Text(`IBAN  ${p.iban}`, { size: 9, color: INK })] : []),
    ...(p?.bic ? [Text(`BIC  ${p.bic}`, { size: 9, color: INK })] : []),
    Text(`${L.remittance}  ${reference}`, { size: 9, color: MUTED }),
  ];

  return Box({ bg: PANEL, padding: { x: 14, y: 12 }, radius: 4, keepTogether: true }, [
    Row({ gap: 24, align: "start" }, [
      Expanded({ flex: 1 }, Column({ gap: 2 }, left)),
      Expanded({ flex: 1 }, Column({ gap: 2 }, right)),
    ]),
  ]);
}

// --- legal footer band: identity + tax ids + register + bank ---
/** "Rechnung RE-2026-118" / "Gutschrift …" - BT-3 decides the word (§14 Abs. 4 Nr. 10 UStG).
 *  Exported because the heading and the page footer must never drift apart. */
export function documentTitle(invoice: Invoice, L: InvoiceLabels): string {
  return `${invoice.type === 381 ? L.creditNote : L.invoice} ${invoice.number}`;
}

function legalFooter(invoice: Invoice, L: InvoiceLabels): PDFElement {
  const { seller } = invoice;
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
    PageBuilder(({ pageNumber, pageCount }) =>
      Text(`${documentTitle(invoice, L)} · ${L.page} ${pageNumber} ${L.pageOf} ${pageCount}`, {
        size: 7.5,
        color: MUTED,
        align: "right",
      }),
    ),
  ]);
}
