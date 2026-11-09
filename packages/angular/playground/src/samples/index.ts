import type { FormValues, PdfDocumentFn } from "@jasy/angular";
import type { RenderOptions } from "@jasy/pdf";
import { drawingPdf } from "./drawing.pdf";
import { encryptedPdf } from "./encrypted.pdf";
import { MEMBERSHIP_FORM, membershipFields } from "./fill-form";
import { fontsAndImagesPdf } from "./fonts-and-images.pdf";
import { formPdf } from "./form.pdf";
import { helloPdf } from "./hello.pdf";
import { invitationPdf } from "./invitation.pdf";
import { invoicePdf } from "./invoice.pdf";
import { layoutPdf } from "./layout.pdf";
import { newspaperPdf } from "./newspaper.pdf";
import { reportPdf } from "./report.pdf";
import { transparencyPdf } from "./transparency.pdf";
import { typographyPdf } from "./typography.pdf";

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
  document?: PdfDocumentFn<any>;
  options?: (values: Values) => RenderOptions;
  /** Instead of a document: an existing PDF, filled from the controls. */
  fill?: { source: string; fields: (values: Values) => FormValues };
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
    id: "report",
    group: "Documents",
    title: "Report",
    look: "Header and footer repeat; from page 2 the header says so.",
    file: "report.pdf.ts",
    controls: [{ key: "sections", label: "Sections", type: "range", initial: 7, min: 1, max: 40 }],
    document: reportPdf,
  },
  {
    id: "invitation",
    group: "Documents",
    title: "Invitation",
    look: "A5, full bleed: Expanded fills the page.",
    file: "invitation.pdf.ts",
    document: invitationPdf,
  },
  {
    id: "newspaper",
    group: "Documents",
    title: "Newspaper",
    look: "Balanced columns, then a Flow through a page layout of your own.",
    file: "newspaper.pdf.ts",
    document: newspaperPdf,
  },
  {
    id: "layout",
    group: "jasy's power",
    title: "Layout",
    look: "Flex, wrap, alignSelf, zIndex, a rotated stamp, gradients.",
    file: "layout.pdf.ts",
    document: layoutPdf,
  },
  {
    id: "typography",
    group: "jasy's power",
    title: "Typography",
    look: "Kerning, spans, justification, ellipsis, spacing.",
    file: "typography.pdf.ts",
    document: typographyPdf,
  },
  {
    id: "drawing",
    group: "jasy's power",
    title: "Drawing",
    look: "A chart painted from data, transforms, inline SVG.",
    file: "drawing.pdf.ts",
    document: drawingPdf,
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
    id: "transparency",
    group: "jasy's power",
    title: "Transparency",
    look: "A PNG's alpha channel over colored panels.",
    file: "transparency.pdf.ts",
    document: transparencyPdf,
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
  {
    id: "fill",
    group: "jasy's power",
    title: "Fill a PDF",
    look: "An existing PDF form, filled live as you type.",
    file: "fill-form.ts",
    controls: [
      { key: "name", label: "Full name", type: "text", initial: "Grace Hopper" },
      { key: "notes", label: "Notes", type: "text", initial: "Filled by @jasy/angular" },
      { key: "plan", label: "Plan (basic or pro)", type: "text", initial: "basic" },
    ],
    fill: { source: MEMBERSHIP_FORM, fields: (v) => membershipFields(v as never) },
  },
  {
    id: "encrypted",
    group: "jasy's power",
    title: "Encrypted",
    look: "AES-256: the viewer asks for the password.",
    file: "encrypted.pdf.ts",
    controls: [{ key: "password", label: "Password", type: "text", initial: "secret" }],
    document: encryptedPdf,
    options: (v) => ({ encrypt: { userPassword: v["password"] || "secret" } }),
  },
];
