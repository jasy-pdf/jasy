# @jasy/e-invoice — CLAUDE.md

ZUGFeRD / Factur-X / XRechnung on top of `@jasy/pdf`: one `Invoice` object in, a PDF/A-3 with the
EN 16931 XML embedded out, in both permitted syntaxes (CII and UBL). This is the strategic prize of
the whole project and it is **legally critical** - a wrong invoice costs a customer money, not a
pixel. Read this before touching anything here.

## The shape

`src/invoice.ts` is the model and the public API; every field carries its `BT-` / `BG-` code in its
own doc comment. `compute.ts` derives every total and the VAT breakdown - the user never types a sum,
so the BR-CO total rules cannot fail. `cii.ts` and `ubl.ts` write the two syntaxes from the same
model and the same computed figures. `template.ts` draws the paper. `profile-check.ts` is the
pre-flight (`en16931Problems`, `xrechnungProblems`): plain sentences before the file exists. `render.ts`
assembles the PDF/A-3. `skonto.ts`, `allowance.ts`, `attachment.ts` each own ONE derived thing.

**Provide inputs, we compute the maths.** Anything derivable is derived, in exactly one place, and
every consumer (totals, CII, UBL, paper, the CLI reader) reads that place. `acAmount` resolves an
allowance whether it was stated as a sum or as `baseAmount` + `percent`; `resolveDiscounts` turns a
Skonto tier into its deadline and amounts. Four separate `base * percent / 100` expressions is how
the printed figure and the billed figure start disagreeing.

## The question "do we cover everything?" has exactly one answer

**`COVERAGE.md`** in this directory (gitignored - ours, not shipped). Every business term of the
standard, read out of the source, with the counts DERIVED from the rows. It exists because that
question was answered "yes" five times from memory while `invoice.ts`'s own header listed the
deferred groups. Never answer it from memory again; update the register and read the number.

The term LIST itself was compiled from knowledge and then cross-checked against the Peppol BIS 3.0
syntax binding (2026-09-11): two address-line-3 terms were missing and are in now; the register and
Peppol name the same business terms. The crawl is one command away if the list ever changes.

Deferred on purpose, documented in `invoice.ts`: tax representative (BG-11/12), payment card (BG-18),
item attributes (BG-32), item classification (BT-158). Left for 1.1 on the board: BT-147/148 (list
price with discount - a BG-27 line allowance already expresses the same money), BT-7/8 (VAT point
date), BT-15/16 (receiving/despatch advice).

## The schemas are the authority, not memory

`schema/cii` (Factur-X 1.08) and `schema/ubl` (UBL 2.1) are vendored. **CII is sequence-bound**: a
correct element in the wrong slot is an invalid file, and the business-rule validator does not check
sequence. `tests/cii-order.test.ts` and `tests/ubl-order.test.ts` DERIVE the expected order from the
XSDs, never from a hand-typed list; they caught `AccountingCost` before `BuyerReference` and
`OriginatorDocumentReference` before `ContractDocumentReference`, both of which every other check
waved through. Before placing a new element, read its parent's `complexType` in the XSD:

```bash
awk '/complexType name="HeaderTradeSettlementType"/,/<\/xs:complexType>/' schema/cii/*Reusable*.xsd | grep -o 'name="[A-Za-z]*"'
```

Things the XSD settled that would otherwise have been guesses: BT-26 is `qdt:` not `udt:` (the only
qualified type we emit); `TaxTotalAmount` has `maxOccurs="2"`, which IS how BT-110 and BT-111 are
told apart (same tag, different `currencyID`); `RoundingAmount` sits before `GrandTotalAmount` yet
moves the PAYABLE, not the total - follow the semantics, not the sequence.

**The two syntaxes disagree constantly.** BT-13/BT-14 are two CII elements but one UBL
`OrderReference`; BT-17/BT-18/BG-24 share one CII element told apart by `TypeCode` (50 / 130 / 916)
but are three different UBL elements; BT-21 has a CII element and NO UBL element (the binding
prefixes the note with `#CODE#`); BG-19 is scattered over three CII blocks and kept in two UBL ones;
BT-90 hangs on the UBL SELLER party with `schemeID="SEPA"`, in the same element as BT-29.

## Traps

**Skonto is not an allowance.** A discount conditional on early payment must not reduce the total,
because at issue nobody knows whether it will be taken. It lives in BT-20 as `#SKONTO#TAGE=n#PROZENT=n.nn#`
beneath the human terms. Entered as an allowance - the obvious workaround - it deducts immediately:
schema-valid, factually false, invisible to every validator. `profile-check` names that mistake by
matching the allowance's reason text. The rationale lives in `skonto.ts` ONCE; do not copy it.

**A non-EUR invoice used to go out with no Euro tax figure and no warning.** Same shape as Skonto:
input accepted, deficient document, silence. `xrechnungProblems` now demands BT-6/BT-111 when the
currency is not EUR. The amount is NEVER derived - which exchange rate applies is a tax question.

**Attachment names collide silently.** A supporting document named `factur-x.xml` lands in the same
name tree as the invoice XML; a reader picks whichever it finds first, and veraPDF calls the file
compliant (measured). Reserved names and duplicates are REFUSED, never renamed - the name is written
twice (PDF key and XML `filename`), so renaming one half would make the halves disagree. A supporting
file is attached as `Supplement`, never `Data` - only the invoice XML is the invoice, and calling both
the same tells a reader the timesheet is.

**Paper and XML must say the same thing, and no validator checks it.** That is the defect that got
four real invoices rejected. `tests/completeness.test.ts` sets EVERY optional field to a `MARK-…`
marker and insists each reaches the page; anything deliberately left off the paper is listed there
with a reason. A value in the XML the paper does not show is a bug, not a decision.

**Percent and amount can contradict.** An allowance may state both; the amount WINS (it is what the
totals use) and `profile-check` reports the disagreement with both figures. Overruling the user
silently would hide a typo.

**`fixture-is-maximal` matches a field NAME anywhere in the file.** Known weakness, unfixed:
`baseAmount`/`percent` passed vacuously once `cashDiscounts` introduced those names.

## The tests that guard, and what each one is for

- **`fixture-is-maximal`** - `tests/support/maximal.ts` sets every field of the model, and this test
  reads the model to prove it. Every symmetry test runs against THAT fixture and no other: a fixture
  shaped by the consumer cannot find what the consumer lacks (the CLI round-trip ran for weeks on
  one shaped by the parser and could never notice a missing field).
- **`completeness`** - every field that reaches the XML reaches the paper.
- **`cii-order` / `ubl-order`** - sequence derived from the vendored XSDs.
- **`determinism`** - the same invoice twice is byte-identical, with a counter-test that a changed
  number DOES change the bytes so it cannot pass vacuously. Byte-stable per library VERSION.
- **`packages/cli/tests/parse.test.ts`** - `generate → parse → regenerate` is byte-identical against
  `maximalInvoice`, both syntaxes. A field the writer learns and the reader does not fails here.

## How to verify - the three gates, and only one is ours

1. **Pre-flight**: `en16931Problems(invoice)` / `xrechnungProblems(invoice)` - a courtesy, never the
   authority. It knows only the rules we wrote into it.
2. **Arithmetic by construction** - `computeInvoice`. The one gate we can guarantee.
3. **The official validators**, foreign software with the last word:
   - PDF/A-3b: `~/.jasy/verapdf/verapdf -f 3b <file>.pdf` → look for `isCompliant="true"`.
   - Schema: `xmllint --noout --schema schema/cii/Factur-X_1.08_EN16931.xsd <cii>.xml` and
     `xmllint --noout --schema schema/ubl/maindoc/UBL-Invoice-2.1.xsd <ubl>.xml`.
   - Attachments really embedded: `pdfdetach -list <file>.pdf`, and `pdfdetach -save N` to prove the
     bytes survive.
   - **KoSIT schematron (EN 16931 + XRechnung business rules): NOT available locally.** It runs on
     server02 and is Flo's run. Nothing here is "done" until he has run it.

A demo render goes to `claude-data/out/<topic>/` and its path is named in the report, every time.

## Working here

Same agreement as the root: phase by phase, Flo approves each gate, Claude never commits. Comments in
English, short, and about what breaks on the NEXT grab - not about what broke on the last one. The
landing docs (`~/projects/jasy-landing/content/docs/4.invoicing/`) describe this package in English;
every example there is verified against the real library before it goes out.
