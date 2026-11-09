<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/angular</h1>

<p align="center">
  <b>PDFs in Angular, the Angular way: a service, a provider and a signal-based resource.</b>
</p>

`@jasy/angular` connects the [`@jasy/pdf`](https://npmx.dev/@jasy/pdf) engine to Angular. You write a
document as a function, `inject(JasyPdf)` turns it into a real PDF, and `pdfResource()` keeps a preview
in sync with your signals. It renders in the browser, with no headless browser, no server round-trip
and no Java.

```ts
// invoice.pdf.ts - a document is a function, and it may inject() like a functional guard
import { formatCurrency } from "@angular/common";
import { LOCALE_ID, inject } from "@angular/core";
import type { PdfDocumentFn } from "@jasy/angular";
import { Document, Page, Row, Table, Text } from "@jasy/pdf";

export interface Invoice {
  number: string;
  items: { desc: string; amount: number }[];
}

export const invoicePdf: PdfDocumentFn<Invoice> = (invoice) => {
  const locale = inject(LOCALE_ID);
  const eur = (n: number) => formatCurrency(n, locale, "€", "EUR");

  return Document({ size: 11 }, [
    Page({ size: "A4", gap: 16 }, [
      Row({ justify: "between" }, [
        Text("Acme GmbH", { size: 22, bold: true, color: "#0a2348" }),
        Text(`INVOICE ${invoice.number}`, { size: 22, bold: true, color: "#1450aa" }),
      ]),
      Table(
        {
          columns: ["1fr", 120],
          cellBorder: "#e2e8f0",
          cellPadding: 8,
          header: ["Description", "Amount"],
        },
        invoice.items.map((item) => [item.desc, Text(eur(item.amount), { align: "right" })]),
      ),
    ]),
  ]);
};
```

```ts
// invoice-preview.ts
import { Component, inject, input } from "@angular/core";
import { JasyPdf, pdfResource } from "@jasy/angular";
import { invoicePdf, type Invoice } from "./invoice.pdf";

@Component({
  selector: "app-invoice-preview",
  template: `
    @if (preview.value(); as pdf) {
      <iframe [src]="pdf.safeUrl" title="Invoice"></iframe>
    }
    <button (click)="download()">Download</button>
  `,
})
export class InvoicePreview {
  private readonly pdf = inject(JasyPdf);
  readonly invoice = input.required<Invoice>();

  // Renders again whenever the invoice changes.
  readonly preview = pdfResource(invoicePdf, () => this.invoice());

  download() {
    return this.pdf.download(invoicePdf, this.invoice(), `invoice-${this.invoice().number}.pdf`);
  }
}
```

## Why

- **Built the way Angular builds.** `provideJasy()` in `app.config.ts`, `inject(JasyPdf)` where you
  need a PDF, and `pdfResource()` on top of Angular's own `resource()`.
- **Documents run in an injection context**, like functional guards and resolvers. `inject(LOCALE_ID)`
  gives you the app's language, and `inject()` reaches any of your services. A tagged PDF takes its
  language from `LOCALE_ID` as well.
- **A preview that follows your signals.** `pdfResource()` renders again when its signals change, and
  drops a result that a newer one replaced. It frees the old `blob:` URL, and `safeUrl` goes straight
  into `<iframe [src]>`.
- **Real layout, real pagination.** `Row`/`Column` flex, wrapping, `%` sizes, a table whose header row
  repeats on every page, newspaper columns, form fields, AES-256. Not a drawing API you hand
  absolute coordinates.
- **Existing PDFs too.** `inject(JasyForms)` reads and fills the form of a PDF you already have, and
  `filledPdfResource()` fills it live from an Angular form.
- **Runs in the browser.** The PDF is produced client-side. `render()` works on the server too.

## Install

```bash
pnpm add @jasy/angular @jasy/pdf
```

Angular 20 or newer. `pdfResource()` builds on Angular's `resource()`, which Angular marks experimental
in 20 and 21 and stable from 22. The service does not depend on it.

`@jasy/pdf` brings three CommonJS dependencies, and `ng build` warns about them. They work as they
are. To silence the warnings, add them to `angular.json`:

```json
"build": {
  "options": {
    "allowedCommonJsDependencies": ["svgpath", "brotli", "base64-js"]
  }
}
```

## Setup

Optional. Without it, `inject(JasyPdf)` works with the standard fonts and the engine's defaults.

```ts
// app.config.ts
import { provideJasy } from "@jasy/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideJasy({
      // Every document can use these by name: Text("...", { font: "Inter" }).
      fonts: {
        Inter: { normal: "/fonts/Inter-Regular.woff2", bold: "/fonts/Inter-Bold.woff2" },
      },
      // Applied to every PDF; the options of a single call win.
      defaults: { accessible: true },
    }),
  ],
};
```

A font URL is loaded the first time a PDF needs it and kept for the app's lifetime. `.ttf`, `.woff`
and `.woff2` all work, and bytes (`Uint8Array`) work too. If a request fails, the next PDF tries again.

A URL, here and for a form, goes through your `HttpClient` when the app provides one, so your
interceptors apply. Without it, jasy uses `fetch`.

## Fill an existing PDF

An application form, a contract with fields: `JasyForms` reads and fills it. The source is a URL, the
`File` of an `<input type="file">`, or bytes.

```ts
// application.ts
import { Component, inject } from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { JasyForms, JasyPdf, filledPdfResource } from "@jasy/angular";

const SOURCE = "/forms/application.pdf";

@Component({
  selector: "app-application",
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form">
      <input formControlName="full_name" />
      <input type="checkbox" formControlName="agree" />
    </form>
    @if (preview.value(); as pdf) {
      <iframe [src]="pdf.safeUrl" title="Application"></iframe>
    }
    <button (click)="send()">Download</button>
  `,
})
export class Application {
  private readonly forms = inject(JasyForms);
  private readonly pdf = inject(JasyPdf);

  readonly form = new FormGroup({
    full_name: new FormControl(""),
    agree: new FormControl(false),
  });

  // The PDF fills itself as the user types. The source is loaded once.
  readonly preview = filledPdfResource(
    SOURCE,
    toSignal(this.form.valueChanges, { initialValue: this.form.value }),
  );

  async send() {
    // flatten: the values become page content and can no longer be edited.
    const { bytes } = await this.forms.fill(SOURCE, this.form.value, { flatten: true });
    await this.pdf.download(bytes, "application.pdf");
  }
}
```

The field names are the PDF's own; `inject(JasyForms).read(source)` lists them, with their types and
choices. The PDF reader is loaded on first use, so an app that only creates PDFs never downloads it.

## API

### `inject(JasyPdf)`

| Method                                          | Does                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `render(document, data, options?)`              | The PDF bytes, a `Uint8Array`. Browser and server.                          |
| `blob(document, data, options?)`                | The PDF as a `Blob`, ready for an upload.                                   |
| `download(document, data, filename?, options?)` | Saves the PDF in the browser.                                               |
| `open(document, data, options?)`                | Opens the PDF in a new tab. Call it from a click, or the browser blocks it. |
| `download(bytes, filename?)` · `open(bytes)`    | The same for a finished PDF, such as a filled form.                         |

`options` are the `@jasy/pdf` `RenderOptions`: `{ encrypt: { userPassword } }` for AES-256,
`{ accessible: true }` for a tagged PDF (PDF/UA), `onDiagnostic` for what the engine has to say.
`download()` and `open()` need a browser, and on the server they throw a `JasyBrowserOnlyError`.

### `pdfResource(document, data?, { options?, injector? })`

An Angular `ResourceRef`: `value()`, `isLoading()`, `error()`, `reload()`. The value holds the PDF's
`bytes`, its `url` and `safeUrl`.

- `data` is read like `resource({ params })`. Return `undefined` to wait, for example until an input
  has a value.
- `options` can be a function, and it is tracked like `data`. A signal in it renders the PDF again.
- On the server it stays idle, since a preview there has nobody to look at it.

### `inject(JasyForms)`

| Method                           | Does                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| `read(source, options?)`         | The fields: names, types, current values, choices.                      |
| `fill(source, values, options?)` | Fills the fields by name. `{ flatten: true }` freezes them in one step. |
| `flatten(source, options?)`      | Turns the fields into page content.                                     |

`source` is a URL, a `Blob` or `File`, or a `Uint8Array`. A value that is `undefined` leaves its
field as it is, the way an Angular form leaves out a disabled control. The options are those of
`@jasy/pdf/edit`, e.g. `password` for an encrypted PDF.

### `filledPdfResource(source, values, { options?, injector? })`

Like `pdfResource`, for an existing form: filled again whenever `values` changes, with the source
loaded once.

### `PdfDocumentFn<T>`

The type of a document: `(data: T) => Document(...)`, sync or async. `PdfDocumentFn` without a type
argument is a document that takes no data.

## Testing

`JasyPdf` and `JasyForms` are injection tokens like any other:

```ts
TestBed.configureTestingModule({
  providers: [{ provide: JasyPdf, useValue: { download: vi.fn() } }],
});
```

## Try it

```bash
git clone https://github.com/jasy-pdf/jasy && cd jasy && pnpm install && pnpm run build
pnpm --filter @jasy/angular play
```

The playground is an Angular CLI app. It renders twelve documents in the browser, side by side with
their source: an invoice that grows across pages, a newspaper, layout, typography, drawing, fonts, form
fields, encryption.

---

Part of [Jasy](https://jasy.dev) - a declarative, dependency-light PDF toolkit in pure TypeScript.
MIT, by Florian Heuberger.
