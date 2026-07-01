<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="130" alt="jasy">
</p>

<h1 align="center">jasy</h1>

<p align="center">
  <b>ZUGFeRD &amp; XRechnung e-invoices in pure TypeScript - generate, validate, read.</b><br>
  A Flutter-style PDF engine underneath. The EN-16931 maths done <i>for</i> you. Zero Java, zero upload.
</p>

<p align="center">
  <code>npm i @jasy/zugferd</code> &nbsp;·&nbsp; <code>npx @jasy/cli</code> &nbsp;·&nbsp; MIT
</p>

---

## Don't believe us. Point it at your own invoice.

```bash
npx @jasy/cli validate ./your-invoice.pdf
```

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/validate.png" width="430" alt="jasy validate: VALID">
</p>

That `✓` is the **same official KoSIT Schematron + veraPDF the big players run** - against the EN 16931
**and** the German XRechnung (BR-DE) rules, plus PDF/A-3. Your file, your terminal, in seconds. No
account, no upload, nothing leaves your machine.

> Java has **Mustang**. PHP has **horstoeko**. Python has **factur-x**.<br>
> Node had nothing. **Now it has jasy.**

---

## You bring the line items. jasy does the rest.

You never compute a total, a VAT breakdown or a rounding again. You hand jasy the line items - it
**derives** the document totals and the EN-16931 VAT breakdown, spec-correct. That is _why_ the
invoices validate: the amounts are correct **by construction**, so the single biggest class of
EN-16931 failures (the BR-CO total checks) simply cannot happen.

```ts
import { renderZugferd } from "@jasy/zugferd";

const { bytes, xml } = await renderZugferd({
  number: "RE-2026-001",
  issueDate: "2026-06-17",
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
      name: "Brand identity design",
      quantity: 2,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
});
// bytes -> a valid ZUGFeRD PDF/A-3   ·   xml -> the embedded EN-16931 XML
// totals, tax breakdown and rounding: computed for you.
```

One object in. A conformant, human-readable PDF/A-3 **and** the EN-16931 CII/UBL XML out. ZUGFeRD and
XRechnung work out of the box - no config, no template wrangling.

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/invoice.png" width="450" alt="a generated ZUGFeRD invoice">
</p>

---

## The whole loop, from the terminal

```bash
jasy read invoice.pdf               # identify + show: parties, line items, totals
jasy validate invoice.pdf           # EN 16931 + XRechnung + PDF/A (exit 1 if invalid)
jasy export invoice.pdf -o out.xlsx # read it back: JSON · TXT · Excel
```

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/read.png" width="520" alt="the jasy terminal: invoice + checks + export">
</p>

Reads **CII and UBL**, real third-party invoices included - not just our own output.

---

## A PDF engine that reads like Flutter

Underneath it all is a declarative, component-based PDF engine - written from the byte stream up, no
headless browser, no `pdf-lib`. You describe the document; it lays it out and paginates.

```ts
import { Document, Page, Column, Text, renderToBytes } from "@jasy/pdf";

const pdf = await renderToBytes(
  Document([
    Page({ size: "A4", margin: 48 }, [
      Column({ gap: 8 }, [
        Text("Invoice RE-2026-001", { size: 24, bold: true, color: "steelblue" }),
        Text("Thank you for your business.", { color: "gray" }),
      ]),
    ]),
  ]),
);
```

Real text layout (Adobe AFM metrics, kerning, word-wrap), flexbox-style `gap` / `justify` / `align`,
boxes with radius and alpha, images, custom TrueType fonts, **AES-256 password encryption**, and **real
pagination** - content that overflows flows onto the next page, headers and footers repeat.

---

## Under the hood - and every bit is real

This is not a wrapper around someone else's renderer. It is built from the byte stream up, and you can
verify all of it:

- **Hand-rolled PDF writer.** No `pdf-lib`, no PDFKit, no Java, no headless Chrome - the byte stream is ours.
- **Font subsetting.** Only the glyphs you actually use are embedded, with the PDF/A subset tag - a
  740 KB font ships as a ~76 KB subset, and the text stays copy- and searchable.
- **Compression.** Content streams and images are FlateDecode-compressed; the spreadsheets `jasy export`
  writes are real `.xlsx` ZIPs we deflate with our own writer and CRC32, zero dependencies.
- **AES-256 encryption, pure JS.** Lock a PDF with `renderToBytes(doc, { encrypt: { userPassword } })` - the
  newest standard handler (AES-256, R6 / ISO 32000-2) via the platform WebCrypto: no native crypto, no deps,
  the same code in Node **and** the browser. Owner password + permissions optional.
- **Real font metrics.** Text is laid out with the Adobe AFM metrics of the standard-14 fonts - kerning
  and word-wrap are _computed_, not guessed.
- **PDF/A-3, matched not approximated.** The conformance graph is hand-built and **passes veraPDF**, the
  official ISO 19005 validator.
- **Byte-exact round-trips.** Generate and parse are inverses: `generate → parse → regenerate` reproduces
  the identical XML. 307 tests hold the line.
- **Schematron, local.** The official EN-16931 + XRechnung rules run via saxon-js (the real XSLT, in pure
  JS) - no Java, no upload.

---

## Packages

| Package                                             | What it is                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **[@jasy/zugferd](https://npmx.dev/@jasy/zugferd)** | ZUGFeRD / XRechnung: your data → PDF/A-3 + EN-16931 XML, with local validation. **The prize.** |
| **[@jasy/cli](https://npmx.dev/@jasy/cli)**         | the `jasy` terminal: read · validate · export, headless **and** interactive                    |
| **[@jasy/pdf](https://npmx.dev/@jasy/pdf)**         | the declarative, Flutter-style PDF layout engine that powers them                              |

---

## Why you can trust it

- **307 tests, green.** The generator and the parser are **byte-exact inverses**:
  `generate → parse → regenerate` reproduces the identical XML. Nothing is silently lost.
- **The same rules the authorities use** - the official KoSIT EN-16931 + XRechnung Schematron, and the
  official **veraPDF** for the full ISO 19005 (PDF/A) check.
- **Proven on real third-party invoices**, not only our own.
- **100% local.** No upload, no service, no account - DSGVO-safe by construction.

---

## Honest scope

jasy targets the documents that matter here: invoices, reports, quotes, datasheets. It is **not** a
LaTeX / WeasyPrint replacement - no microtypography, hyphenation or bidi, and arbitrary multi-page flow
of _any_ content is still maturing. For e-invoices (a table, totals, a footer) it is complete - they
even paginate. We would rather under-promise and over-deliver in the demo above.

> **Status:** young and pre-1.0. The API can still shift between minor versions. Everything shown here
> works and is tested.

---

<p align="center">
  MIT &nbsp;·&nbsp; built by <a href="https://github.com/jasy-pdf">Florian Heuberger</a>
</p>
