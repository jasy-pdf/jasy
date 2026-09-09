<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/e-invoice</h1>

<p align="center">
  <b>ZUGFeRD &amp; XRechnung e-invoices in pure TypeScript.</b><br>
  One object in - a conformant PDF/A-3 and the EN-16931 XML out. No Java, no headless browser, no upload.
</p>

<p align="center"><code>npm i @jasy/e-invoice</code> &nbsp;·&nbsp; MIT</p>

---

## One call. A complete, conformant invoice.

You bring the line items. `@jasy/e-invoice` **derives the totals and the VAT breakdown**, lays out a
human-readable PDF/A-3, and embeds the EN-16931 XML right inside it.

```ts
import { renderZugferd } from "@jasy/e-invoice";

const { bytes, xml } = await renderZugferd(
  {
    number: "INV-2026-0042",
    issueDate: "2026-06-21",
    dueDate: "2026-07-05",
    currency: "EUR",
    seller: {
      name: "Northwind Studio GmbH",
      vatId: "DE123456789",
      address: { city: "Berlin", postCode: "10115", country: "DE" },
    },
    buyer: {
      name: "Globex Corporation Ltd",
      address: { city: "Munich", postCode: "80331", country: "DE" },
    },
    lines: [
      {
        name: "Website design & build",
        quantity: 1,
        unit: "C62",
        netUnitPrice: 9600,
        vat: { category: "S", ratePercent: 19 },
      },
      {
        name: "Printed brand book",
        quantity: 25,
        unit: "C62",
        netUnitPrice: 28,
        vat: { category: "S", ratePercent: 7 },
      },
    ],
  },
  { locale: "en" }, // de / en / fr - or override individual labels
);
// bytes -> a valid ZUGFeRD PDF/A-3   ·   xml -> the embedded EN-16931 XML
```

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/invoice.png" width="460" alt="a generated ZUGFeRD invoice">
</p>

## You never do the invoice math again

Hand it the line items - it computes the line nets, the document totals and the EN-16931 VAT breakdown,
with spec-correct rounding. The amounts are correct **by construction**, so the single biggest class of
EN-16931 failures (the BR-CO total checks) simply cannot happen. Discounts, surcharges and reverse-charge
(category AE, with the exemption reason) are handled for you.

## The fields a real invoice actually needs

```ts
payment: {
  cashDiscounts: [{ days: 14, percent: 2 }],           // Skonto, written into BT-20 (see below)
  directDebit: { mandateReference: "MND-2024-00871" }, // SEPA collection
},
allowancesCharges: [
  { isCharge: false, baseAmount: 3980, percent: 10, reason: "Framework agreement",
    vat: { category: "S", ratePercent: 19 } },         // "10%", not a pre-computed sum
],
precedingInvoices: [{ number: "INV-0187", issueDate: "2026-08-14" }], // what a credit note corrects
supportingDocuments: [{ reference: "TS-09", file: { content, mimeType, filename } }], // a timesheet
roundingAmount: -0.4,                                   // collect a round figure
taxCurrency: "EUR", taxTotalInTaxCurrency: 172.4,       // invoicing in a foreign currency
```

**Skonto is not a discount**, and that distinction is the reason it has its own field. A reduction
that only applies on early payment must not reduce the invoice total - entered as an allowance it
would be deducted immediately, giving a file that passes every validator and states the wrong sum.
It goes into the payment terms in the form XRechnung reads back, and the pre-flight names the mistake
if you reach for an allowance instead.

An attachment travels **twice**: base64 in the XML for a machine, and as an embedded file in the
PDF/A-3 for a person.

## ZUGFeRD and XRechnung. CII and UBL.

```ts
import { renderZugferd, toCII, toUBL, computeInvoice } from "@jasy/e-invoice";

await renderZugferd(invoice, { profile: "xrechnung" }); // the German B2G profile (Leitweg-ID, BR-DE)
toCII(invoice, computeInvoice(invoice)); // the raw UN/CEFACT CII XML
toUBL(invoice, computeInvoice(invoice)); // the raw OASIS UBL XML
```

EN 16931 and the German **XRechnung** profile, in **both** permitted syntaxes - out of the box.

## Validate it - locally, against the real rules

The XML this emits passes the **official KoSIT EN-16931 + XRechnung Schematron**; the PDF passes
**veraPDF**, the official ISO 19005 (PDF/A) validator. Don't take our word for it - check any invoice,
yours or ours, with [`@jasy/cli`](https://npmx.dev/@jasy/cli):

```bash
npx @jasy/cli validate ./invoice.pdf
```

## Under the hood

- **Hand-built PDF/A-3** that passes veraPDF - matched, not approximated. No Java.
- **Font subsetting + compression** - only the glyphs you use are embedded; streams are FlateDecode'd.
- **Byte-exact round-trips** - `generate → parse → regenerate` reproduces the identical XML, in both
  syntaxes, checked against the same maximal fixture the writer is measured by. A field the writer
  learns and the reader does not now fails a test instead of disappearing quietly.
- Built on [`@jasy/pdf`](https://npmx.dev/@jasy/pdf), a hand-rolled, Flutter-style PDF engine.

## Why this exists

Java has **Mustang**. PHP has **horstoeko**. Python has **factur-x**. Node had nothing polished and
dependency-light. Now it has jasy.

## Honest scope

Every EN-16931 business term was audited field by field on 2026-09-09; the register is in the
repository as `packages/e-invoice/COVERAGE.md`. Every mandatory term is emitted, and so is everything
a real business hits.

Six optional terms are deliberately left for 1.1: **BT-147/BT-148** (list price with a discount - a
line allowance already expresses the same money), **BT-7/BT-8** (VAT point date, for prepayments) and
**BT-15/BT-16** (receiving and despatch advice, pure logistics). Deliberately deferred and documented
in the model: tax representative (BG-11/12), payment card (BG-18), item attributes (BG-32) and item
classification (BT-158).

Pre-1.0: the API can still shift between minor versions. Everything shown here works and is tested.

---

<p align="center">MIT &nbsp;·&nbsp; part of <a href="https://github.com/jasy-pdf/jasy">jasy</a></p>
