// Compiled by types.test.ts, never run: what a user may write, and - after @ts-expect-error - what not.
import { FormControl, FormGroup } from "@angular/forms";
import { inject } from "@angular/core";
import {
  JasyForms,
  JasyPdf,
  pdfResource,
  type PdfDocumentFn,
  type PdfFile,
  type PdfResourceRef,
} from "../../src/index.ts";
import { Document, Page, Text } from "@jasy/pdf";

const noData: PdfDocumentFn = () => Document([Page([Text("Hi")])]);
const withData: PdfDocumentFn<{ n: number }> = (d) => Document([Page([Text(String(d.n))])]);

export function calls() {
  const pdf = inject(JasyPdf);
  // A document without data takes none.
  void pdf.render(noData);
  void pdf.blob(noData);
  void pdf.download(noData);
  void pdf.download(noData, undefined, "a.pdf");
  void pdf.open(noData);
  // A document with data needs it, of its type.
  void pdf.render(withData, { n: 1 });
  // @ts-expect-error - the data is missing
  void pdf.render(withData);
  // @ts-expect-error - the data has the wrong type
  void pdf.render(withData, { n: "1" });
  // Finished bytes.
  void pdf.download(new Uint8Array(), "a.pdf");
  void pdf.open(new Uint8Array());

  const a: PdfResourceRef = pdfResource(noData);
  const b: PdfResourceRef = pdfResource(withData, () => ({ n: 1 }));
  // @ts-expect-error - a document with data needs its data function
  pdfResource(withData);
  void a.latest()?.safeUrl;
  void b.value();
  // Angular's own pattern: hasValue() narrows value() to the PDF.
  if (a.hasValue()) {
    const file: PdfFile = a.value();
    void file;
  }

  // An Angular reactive form's value fills a form as it is - numbers and disabled controls included.
  const form = new FormGroup({
    name: new FormControl(""),
    age: new FormControl(0),
    agree: new FormControl(false),
  });
  void inject(JasyForms).fill("/form.pdf", form.value);
}
