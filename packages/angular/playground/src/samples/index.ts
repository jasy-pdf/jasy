import type { PdfDocument } from "@jasy/angular";
import type { RenderOptions } from "@jasy/pdf";
import { fontsAndImagesPdf } from "./fonts-and-images.pdf";
import { formPdf } from "./form.pdf";
import { helloPdf } from "./hello.pdf";
import { invoicePdf } from "./invoice.pdf";

export type Control =
  | { key: string; label: string; type: "text"; initial: string }
  | { key: string; label: string; type: "range"; initial: number; min: number; max: number };
export type Values = Record<string, any>;

export interface Sample {
  id: string;
  group: "Start" | "Documents" | "jasy's power";
  title: string;
  /** What to look at, in one line. */
  look: string;
  /** The sample's file, shown as its source. */
  file: string;
  controls?: Control[];
  /** The controls' values are the document's data. */
  document: PdfDocument<any>;
  options?: (values: Values) => RenderOptions;
}

export const GROUPS = ["Start", "Documents", "jasy's power"] as const;

export const SAMPLES: Sample[] = [
  {
    id: "hello",
    group: "Start",
    title: "Hello world",
    look: "A function becomes a PDF. Change the name.",
    file: "hello.pdf.ts",
    controls: [{ key: "name", label: "Name", type: "text", initial: "world" }],
    document: helloPdf,
  },
  {
    id: "invoice",
    group: "Documents",
    title: "Invoice",
    look: "LOCALE_ID formats the money; the table breaks across pages.",
    file: "invoice.pdf.ts",
    controls: [
      { key: "customer", label: "Bill to", type: "text", initial: "Max Mustermann, Berlin" },
      { key: "lines", label: "Lines", type: "range", initial: 3, min: 1, max: 60 },
    ],
    document: invoicePdf,
  },
  {
    id: "fonts",
    group: "jasy's power",
    title: "Fonts and images",
    look: "A font from provideJasy(), a photo by URL.",
    file: "fonts-and-images.pdf.ts",
    document: fontsAndImagesPdf,
  },
  {
    id: "form",
    group: "jasy's power",
    title: "Form",
    look: "Real form fields: click into the PDF and type.",
    file: "form.pdf.ts",
    controls: [{ key: "name", label: "Full name", type: "text", initial: "Ada Lovelace" }],
    document: formPdf,
  },
];
