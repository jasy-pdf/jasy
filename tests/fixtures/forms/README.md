# Form-PDF fixtures

A corpus of AcroForm PDFs from **independent producers**, so the form reader is never tested only
against our own output. Reading a form we wrote ourselves proves almost nothing - every producer lays
the same structures out differently, and those differences are exactly where a parser breaks.

| File                      | Producer                                | What it is there to catch                                                                           |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `jasy-form.pdf`           | `@jasy/pdf`                             | our own baseline; every field kind, all appearances baked                                           |
| `pdflib-form.pdf`         | pdf-lib 1.17 (defaults)                 | **xref stream + object streams**, field names as UTF-16BE hex strings                               |
| `pdflib-form-classic.pdf` | pdf-lib 1.17, `useObjectStreams: false` | same content, **classic xref table** - an exact A/B against the file above                          |
| `pdfkit-form.pdf`         | PDFKit                                  | **no `/AP` at all** - relies on `/NeedAppearances`, so filling it forces us to generate appearances |
| `reactpdf-form.pdf`       | @react-pdf/renderer 4.6                 | our closest competitor; builds forms through PDFKit, so it inherits the same traits                 |
| `gov-w9.pdf`              | IRS (Adobe LiveCycle)                   | a REAL form: 23 widgets, object streams, and an **AcroForm/XFA hybrid**                             |

## What the corpus proved (measured, not assumed)

- **Object streams and xref streams are mandatory**, not a nice-to-have: both the real-world form and
  pdf-lib's default output use them.
- **Strings come in two spellings.** pdf-lib writes field names as `<FEFF0066…>` (UTF-16BE with a BOM),
  not as `(literal)`. A reader that only handles literals sees a form with no field names at all.
- **A field may carry no appearance stream.** PDFKit writes none; filling such a form means generating
  the appearance ourselves (`forms/appearance.ts`).
- **`gov-w9.pdf` is an XFA hybrid**: it holds both an AcroForm and an XFA packet. Filling only the
  AcroForm side can be ignored by a viewer that prefers XFA - a case to detect and report, not to
  silently half-do.

## Provenance

The five generated files were produced once with the scripts kept alongside this corpus in the
scratch harness; each is a minimal form holding a text field, a multiline field, a checkbox and a
choice field (plus a radio group, button and signature field where the producer supports them).

`gov-w9.pdf` is the IRS "Request for Taxpayer Identification Number and Certification" form,
downloaded from <https://www.irs.gov/pub/irs-pdf/fw9.pdf>. As a work of the U.S. federal government it
is in the public domain. It is included unmodified, purely as a read-only test input.
