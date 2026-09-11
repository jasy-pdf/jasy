import { deflateRawSync } from "node:zlib";
import { resolveDiscounts, acAmount, hasPercentage } from "@jasy/e-invoice";
import type { Invoice, ComputedInvoice } from "@jasy/e-invoice";

// Export a parsed invoice for humans / downstream systems: JSON (full model + totals), TXT (a readable
// receipt) and XLSX (a minimal hand-rolled spreadsheet - an .xlsx is just a ZIP of XML parts, so we
// build the thin ZIP container ourselves and compress each part with zlib's deflate; no dependency).

export type ExportFormat = "json" | "txt" | "xlsx";

const money = (n: number): string => n.toFixed(2);
const addressLine = (a: {
  line1?: string;
  postCode?: string;
  city?: string;
  country: string;
}): string =>
  [a.line1, [a.postCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");

/** A flat totals summary, the four amounts a reader cares about. */
function summary(inv: Invoice, t: ComputedInvoice) {
  return {
    net: t.taxBasisTotal, // BT-109
    vat: t.taxTotal, // BT-110
    gross: t.grandTotal, // BT-112
    due: t.duePayable, // BT-115
    currency: inv.currency,
  };
}

/**
 * Everything on the invoice beyond the receipt - references, payment, discounts, attachments - as
 * plain text lines. ONE function for both readers (`jasy read` and the TXT export) so the two can
 * never disagree about what an invoice carries; each only decides how to colour it.
 *
 * The order is the order someone opening a SUPPLIER invoice looks for things: how do I pay, is
 * there a discount for paying early, what does this correct, what came with it.
 */
export function detailLines(inv: Invoice, t: ComputedInvoice): string[] {
  const L: string[] = [];
  // A space after the pad, not inside it: "Direct debit" is exactly twelve wide and would glue on.
  const row = (label: string, value: string | undefined) => {
    if (value) L.push(`${label.padEnd(12)} ${value}`);
  };

  // references - the buyer's booking keys first, then the seller's
  row("Order", inv.purchaseOrderRef);
  row("Sales order", inv.salesOrderRef);
  row("Contract", inv.contractRef);
  row("Project", inv.projectRef);
  row("Tender", inv.tenderRef);
  row("Object", inv.objectRef);
  row("Cost centre", inv.buyerAccountingRef);
  if (inv.precedingInvoices?.length) {
    row(
      "Corrects",
      inv.precedingInvoices
        .map((p) => (p.issueDate ? `${p.number} (${p.issueDate})` : p.number))
        .join(", "),
    );
  }

  // payment
  const p = inv.payment;
  if (p) {
    if (L.length) L.push("");
    row("Terms", p.terms);
    if (p.iban)
      row(
        "IBAN",
        `${p.iban}${p.bic ? `  BIC ${p.bic}` : ""}${p.accountName ? `  ${p.accountName}` : ""}`,
      );
    if (p.directDebit) {
      row("Direct debit", `mandate ${p.directDebit.mandateReference}`);
      row("", p.directDebit.creditorId ? `creditor ${p.directDebit.creditorId}` : undefined);
      row("", p.directDebit.debitedIban ? `debited ${p.directDebit.debitedIban}` : undefined);
    }
    for (const d of resolveDiscounts(p.cashDiscounts, inv.issueDate, t.grandTotal)) {
      row(
        "Skonto",
        `${d.percent}% if paid by ${d.deadline}: ${money(d.discountedTotal)} ${inv.currency} (saves ${money(d.discountAmount)})`,
      );
    }
  }

  // what moved the money between the lines and the total
  const acs = inv.allowancesCharges ?? [];
  if (acs.length || t.roundingAmount !== 0 || inv.taxCurrency) {
    L.push("");
    for (const ac of acs) {
      const rate = hasPercentage(ac) ? ` (${ac.percent}% of ${money(ac.baseAmount)})` : "";
      row(
        ac.isCharge ? "Charge" : "Discount",
        `${ac.reason ?? ""}${rate}  ${ac.isCharge ? "+" : "-"}${money(acAmount(ac))}`,
      );
    }
    if (t.roundingAmount !== 0) {
      row("Rounding", `${t.roundingAmount > 0 ? "+" : "-"}${money(Math.abs(t.roundingAmount))}`);
    }
    if (inv.taxCurrency && inv.taxTotalInTaxCurrency !== undefined) {
      row(`VAT in ${inv.taxCurrency}`, money(inv.taxTotalInTaxCurrency));
    }
  }

  // attachments
  if (inv.supportingDocuments?.length) {
    L.push("");
    for (const d of inv.supportingDocuments) {
      const what = d.description ? `${d.description} (${d.reference})` : d.reference;
      const where = d.file ? d.file.filename : d.url ? d.url : "";
      row("Attached", where ? `${what} - ${where}` : what);
    }
  }
  return L;
}

/** Full invoice model + a computed totals block, pretty-printed. */
export function exportJson(inv: Invoice, t: ComputedInvoice): string {
  return JSON.stringify({ ...inv, totals: summary(inv, t) }, null, 2);
}

/** A plain-text receipt - no ANSI, safe to pipe or save. */
export function exportText(inv: Invoice, t: ComputedInvoice): string {
  const L: string[] = [];
  L.push(`Invoice ${inv.number}`);
  L.push(`Date    ${inv.issueDate}${inv.dueDate ? `   due ${inv.dueDate}` : ""}`);
  if (inv.buyerReference) L.push(`Ref     ${inv.buyerReference}`);
  L.push("");
  L.push(`From    ${inv.seller.name}`);
  L.push(`        ${addressLine(inv.seller.address)}`);
  if (inv.seller.vatId) L.push(`        VAT ${inv.seller.vatId}`);
  L.push(`To      ${inv.buyer.name}`);
  L.push(`        ${addressLine(inv.buyer.address)}`);
  L.push("");
  L.push(`${"Qty".padEnd(8)}${"Unit".padEnd(6)}${"Item".padEnd(34)}${"Net".padStart(12)}`);
  inv.lines.forEach((l, i) => {
    L.push(
      `${String(l.quantity).padEnd(8)}${l.unit.padEnd(6)}${l.name.slice(0, 33).padEnd(34)}${money(t.lineNets[i]).padStart(12)}`,
    );
    for (const sub of lineDetailLines(l)) L.push(`${"".padEnd(14)}${sub}`);
  });
  L.push("─".repeat(60));
  const s = summary(inv, t);
  L.push(`${"Net".padStart(48)}${money(s.net).padStart(12)}`);
  L.push(`${"VAT".padStart(48)}${money(s.vat).padStart(12)}`);
  L.push(`${`Total ${s.currency}`.padStart(48)}${money(s.gross).padStart(12)}`);
  // Only when they differ: an amount already paid or a rounding makes the payable a second figure.
  if (s.due !== s.gross) {
    if (inv.paidAmount) L.push(`${"Paid".padStart(48)}${`-${money(inv.paidAmount)}`.padStart(12)}`);
    L.push(`${`Due ${s.currency}`.padStart(48)}${money(s.due).padStart(12)}`);
  }
  const details = detailLines(inv, t);
  if (details.length) L.push("", ...details);
  return L.join("\n") + "\n";
}

/** What a line carries beyond quantity, name and net - shown indented beneath it. */
export function lineDetailLines(l: Invoice["lines"][number]): string[] {
  const L: string[] = [];
  for (const ac of l.allowancesCharges ?? []) {
    const rate = hasPercentage(ac) ? ` (${ac.percent}% of ${money(ac.baseAmount)})` : "";
    L.push(
      `${ac.isCharge ? "charge" : "discount"} ${ac.reason ?? ""}${rate} ${ac.isCharge ? "+" : "-"}${money(acAmount(ac))}`,
    );
  }
  if (l.period) L.push(`period ${l.period.start} to ${l.period.end}`);
  if (l.orderLineRef) L.push(`order line ${l.orderLineRef}`);
  if (l.objectRef) L.push(`object ${l.objectRef}`);
  if (l.buyerAccountingRef) L.push(`cost centre ${l.buyerAccountingRef}`);
  if (l.originCountry) L.push(`origin ${l.originCountry}`);
  return L;
}

// ── minimal ZIP container (for the .xlsx); each part deflated via zlib ──────────────────────────────

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf-8");
    const crc = crc32(f.data); // CRC is always over the *uncompressed* data
    const raw = f.data.length;
    const body = deflateRawSync(f.data); // ZIP method 8 = raw DEFLATE
    const comp = body.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(8, 8); // method 8 = deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp, 18); // compressed size
    local.writeUInt32LE(raw, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(8, 10); // method 8 = deflate
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp, 20);
    cen.writeUInt32LE(raw, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(cen, name);
    offset += local.length + name.length + comp;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Escape `& < >` and drop chars illegal in XML 1.0 (everything < 0x20 except tab/LF/CR), one pass. */
const xmlEsc = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    const ch = s[i];
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
  }
  return out;
};
/** A worksheet cell: inline string or bare number. */
const cell = (ref: string, v: string | number): string =>
  typeof v === "number"
    ? `<c r="${ref}"><v>${v}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
const row = (r: number, cells: (string | number)[]): string =>
  `<row r="${r}">${cells.map((v, i) => cell(`${String.fromCharCode(65 + i)}${r}`, v)).join("")}</row>`;

/** A minimal single-sheet .xlsx with the invoice header, line items and totals. */
export function exportXlsx(inv: Invoice, t: ComputedInvoice): Buffer {
  const s = summary(inv, t);
  const rows: string[] = [];
  let r = 1;
  rows.push(row(r++, ["Invoice", inv.number]));
  rows.push(row(r++, ["Date", inv.issueDate]));
  if (inv.dueDate) rows.push(row(r++, ["Due", inv.dueDate]));
  rows.push(row(r++, ["From", inv.seller.name]));
  rows.push(row(r++, ["To", inv.buyer.name]));
  r++; // blank
  rows.push(row(r++, ["Qty", "Unit", "Item", "Net"]));
  inv.lines.forEach((l, i) => rows.push(row(r++, [l.quantity, l.unit, l.name, t.lineNets[i]])));
  r++; // blank
  rows.push(row(r++, ["", "", "Net", s.net]));
  rows.push(row(r++, ["", "", "VAT", s.vat]));
  rows.push(row(r++, ["", "", `Total ${s.currency}`, s.gross]));

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Invoice" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
    { name: "_rels/.rels", data: Buffer.from(rootRels) },
    { name: "xl/workbook.xml", data: Buffer.from(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(wbRels) },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet) },
  ]);
}

/** Export to the requested format - string for json/txt, Buffer for the binary xlsx. */
export function exportInvoice(
  inv: Invoice,
  t: ComputedInvoice,
  format: ExportFormat,
): string | Buffer {
  if (format === "json") return exportJson(inv, t);
  if (format === "txt") return exportText(inv, t);
  return exportXlsx(inv, t);
}
