<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/zugferd</h1>

<p align="center">
  <b>ZUGFeRD &amp; XRechnung e-invoices in pure TypeScript.</b><br>
  One object in - a conformant PDF/A-3 and the EN-16931 XML out. No Java, no headless browser, no upload.
</p>

<p align="center"><code>npm i @jasy/zugferd</code> &nbsp;·&nbsp; MIT</p>

---

## One call. A complete, conformant invoice.

You bring the line items. `@jasy/zugferd` **derives the totals and the VAT breakdown**, lays out a
human-readable PDF/A-3, and embeds the EN-16931 XML right inside it.

```ts
import { renderZugferd } from "@jasy/zugferd";

const { bytes, xml } = await renderZugferd(
  {
    number: "INV-2026-0042",
    issueDate: "2026-06-21",
    dueDate: "2026-07-05",
    currency: "EUR",
    seller: { name: "Northwind Studio GmbH", vatId: "DE123456789",
              address: { city: "Berlin", postCode: "10115", country: "DE" } },
    buyer:  { name: "Globex Corporation Ltd",
              address: { city: "Munich", postCode: "80331", country: "DE" } },
    lines: [
      { name: "Website design & build", quantity: 1, unit: "C62",
        netUnitPrice: 9600, vat: { category: "S", ratePercent: 19 } },
      { name: "Printed brand book", quantity: 25, unit: "C62",
        netUnitPrice: 28, vat: { category: "S", ratePercent: 7 } },
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

## ZUGFeRD and XRechnung. CII and UBL.

```ts
import { renderZugferd, toCII, toUBL, computeInvoice } from "@jasy/zugferd";

await renderZugferd(invoice, { profile: "xrechnung" }); // the German B2G profile (Leitweg-ID, BR-DE)
toCII(invoice, computeInvoice(invoice));                // the raw UN/CEFACT CII XML
toUBL(invoice, computeInvoice(invoice));                // the raw OASIS UBL XML
```

EN 16931 and the German **XRechnung** profile, in **both** permitted syntaxes - out of the box.

## Validate it - locally, against the real rules

The XML this emits passes the **official KoSIT EN-16931 + XRechnung Schematron**; the PDF passes
**veraPDF**, the official ISO 19005 (PDF/A) validator. Don't take our word for it - check any invoice,
yours or ours, with [`@jasy/cli`](https://www.npmjs.com/package/@jasy/cli):

```bash
npx @jasy/cli validate ./invoice.pdf
```

## Under the hood

- **Hand-built PDF/A-3** that passes veraPDF - matched, not approximated. No Java.
- **Font subsetting + compression** - only the glyphs you use are embedded; streams are FlateDecode'd.
- **Byte-exact round-trips** - `generate → parse → regenerate` reproduces the identical XML (307 tests).
- Built on [`@jasy/pdf`](https://www.npmjs.com/package/@jasy/pdf), a hand-rolled, Flutter-style PDF engine.

## Why this exists

Java has **Mustang**. PHP has **horstoeko**. Python has **factur-x**. Node had nothing polished and
dependency-light. Now it has jasy.

## Honest scope

Covers every mandatory EN-16931 term plus the fields a real invoice needs. A few rare optionals (tax
representative, SEPA direct-debit mandate, item attributes) are not emitted yet. Pre-1.0: the API can
still shift between minor versions. Everything shown here works and is tested.

---

<p align="center">MIT &nbsp;·&nbsp; part of <a href="https://github.com/jasy-pdf/jasy">jasy</a></p>
