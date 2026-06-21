<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/cli</h1>

<p align="center">
  <b>The terminal for ZUGFeRD &amp; XRechnung. Read, validate and export any e-invoice PDF.</b><br>
  Headless for scripts and CI, interactive when you want to look. 100% local - no upload, no account.
</p>

<p align="center"><code>npx @jasy/cli</code> &nbsp;·&nbsp; MIT</p>

---

## Don't believe us. Point it at your own invoice.

```bash
npx @jasy/cli validate ./your-invoice.pdf
```

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/validate.png" width="430" alt="jasy validate: VALID">
</p>

That `✓` runs the **same official KoSIT Schematron + veraPDF the big tools use** - the EN 16931 **and**
the German XRechnung (BR-DE) rules, plus PDF/A-3. It exits non-zero when invalid, so it drops straight
into CI. Your file, your terminal, in seconds.

> Java has **Mustang**. PHP has **horstoeko**. Python has **factur-x**.
> Node had nothing. Now it has jasy.

## Everything it does

```bash
jasy read    invoice.pdf            # identify + show: parties, line items, totals (CII and UBL)
jasy validate invoice.pdf           # EN 16931 + XRechnung + PDF/A  (exit 1 if invalid)
jasy export  invoice.pdf -o x.xlsx  # read it back to JSON, TXT or Excel
jasy                                # the interactive terminal: open, inspect, export
```

<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/read.png" width="520" alt="the jasy terminal">
</p>

Reads **CII and UBL**, real third-party invoices included - not just invoices we made ourselves.

## The full ISO PDF/A check, optional and guided

Structural PDF/A-3 checks run built-in. For the **complete** ISO 19005 verdict, jasy wires up the
official **veraPDF** for you - no account, into `~/.jasy/verapdf`:

```bash
jasy verapdf            # a doctor: is Java here? is veraPDF here? what to run if not
jasy verapdf --install  # downloads + installs it locally (the one requirement is a Java runtime)
```

Once present, `jasy validate` adds the full ISO check automatically. It is never a gate - your own
structural checks carry the everyday case.

## Under the hood

- **Schematron, local** - the official EN-16931 + XRechnung rules run via saxon-js (the real XSLT, in
  pure JS). No upload, DSGVO-safe.
- **Excel by hand** - the `.xlsx` is a ZIP we build ourselves, deflated with our own writer and CRC32.
- **Reads multi-file PDFs** - pulls the right e-invoice XML out even when a tool embedded its own JSON too.
- Generates with [`@jasy/zugferd`](https://www.npmjs.com/package/@jasy/zugferd) on the hand-rolled
  [`@jasy/pdf`](https://www.npmjs.com/package/@jasy/pdf) engine.

---

<p align="center">MIT &nbsp;·&nbsp; part of <a href="https://github.com/jasy-pdf/jasy">jasy</a></p>
