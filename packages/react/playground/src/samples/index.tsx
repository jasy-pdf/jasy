import type { ReactElement } from "react";
import type { RenderOptions } from "@jasy/pdf";
import Hello from "./Hello";
import Invoice from "./Invoice";
import Report from "./Report";
import Invitation from "./Invitation";
import Newspaper from "./Newspaper";
import Layout from "./Layout";
import Typography from "./Typography";
import Drawing from "./Drawing";
import FontsAndImages from "./FontsAndImages";
import Transparency from "./Transparency";
import Form from "./Form";
import Encrypted from "./Encrypted";
import helloSource from "./Hello.tsx?raw";
import invoiceSource from "./Invoice.tsx?raw";
import reportSource from "./Report.tsx?raw";
import invitationSource from "./Invitation.tsx?raw";
import newspaperSource from "./Newspaper.tsx?raw";
import layoutSource from "./Layout.tsx?raw";
import typographySource from "./Typography.tsx?raw";
import drawingSource from "./Drawing.tsx?raw";
import fontsSource from "./FontsAndImages.tsx?raw";
import transparencySource from "./Transparency.tsx?raw";
import formSource from "./Form.tsx?raw";
import encryptedSource from "./Encrypted.tsx?raw";

export interface Assets {
  font: Uint8Array;
  photo: Uint8Array;
  logo: Uint8Array;
}
export type Control =
  | { key: string; label: string; type: "text"; initial: string }
  | { key: string; label: string; type: "range"; initial: number; min: number; max: number };
type Values = Record<string, any>;

export interface Sample {
  id: string;
  group: "Start" | "Documents" | "jasy's power";
  title: string;
  /** What to look at, in one line. */
  look: string;
  source: string;
  controls?: Control[];
  element: (values: Values, assets: Assets) => ReactElement;
  options?: (values: Values) => RenderOptions;
}

export const SAMPLES: Sample[] = [
  {
    id: "hello",
    group: "Start",
    title: "Hello world",
    look: "A component tree becomes a PDF. Change the name.",
    source: helloSource,
    controls: [{ key: "name", label: "Name", type: "text", initial: "world" }],
    element: (v) => <Hello name={v.name} />,
  },
  {
    id: "invoice",
    group: "Documents",
    title: "Invoice",
    look: "Add lines: the table breaks across pages, its header row repeats.",
    source: invoiceSource,
    controls: [
      { key: "customer", label: "Bill to", type: "text", initial: "Max Mustermann, Berlin" },
      { key: "lines", label: "Lines", type: "range", initial: 3, min: 1, max: 60 },
    ],
    element: (v) => <Invoice customer={v.customer} lines={v.lines} />,
  },
  {
    id: "report",
    group: "Documents",
    title: "Report",
    look: "Header and footer repeat on every page; the badge sits on the corner.",
    source: reportSource,
    controls: [{ key: "sections", label: "Sections", type: "range", initial: 7, min: 1, max: 40 }],
    element: (v) => <Report sections={v.sections} />,
  },
  {
    id: "invitation",
    group: "Documents",
    title: "Invitation",
    look: "A5, full bleed: Expanded fills the page.",
    source: invitationSource,
    element: () => <Invitation />,
  },
  {
    id: "newspaper",
    group: "Documents",
    title: "Newspaper",
    look: "Balanced columns, then a Flow through a page layout of your own.",
    source: newspaperSource,
    element: () => <Newspaper />,
  },
  {
    id: "layout",
    group: "jasy's power",
    title: "Layout",
    look: "Flex, wrap, alignSelf, zIndex, a rotated stamp, gradients.",
    source: layoutSource,
    element: () => <Layout />,
  },
  {
    id: "typography",
    group: "jasy's power",
    title: "Typography",
    look: "Kerning, spans, justification, ellipsis, spacing.",
    source: typographySource,
    element: () => <Typography />,
  },
  {
    id: "drawing",
    group: "jasy's power",
    title: "Drawing",
    look: "A chart painted from data, transforms, inline SVG.",
    source: drawingSource,
    element: () => <Drawing />,
  },
  {
    id: "fonts",
    group: "jasy's power",
    title: "Fonts and images",
    look: "A custom .ttf and a photo, both as bytes from the browser.",
    source: fontsSource,
    element: (_, a) => <FontsAndImages font={a.font} photo={a.photo} />,
  },
  {
    id: "transparency",
    group: "jasy's power",
    title: "Transparency",
    look: "A PNG's alpha channel over colored panels.",
    source: transparencySource,
    element: (_, a) => <Transparency logo={a.logo} />,
  },
  {
    id: "form",
    group: "jasy's power",
    title: "Form",
    look: "Real form fields: click into the PDF and type.",
    source: formSource,
    controls: [{ key: "name", label: "Full name", type: "text", initial: "Ada Lovelace" }],
    element: (v) => <Form name={v.name} />,
  },
  {
    id: "encrypted",
    group: "jasy's power",
    title: "Encrypted",
    look: "AES-256: the viewer asks for the password.",
    source: encryptedSource,
    controls: [{ key: "password", label: "Password", type: "text", initial: "secret" }],
    element: () => <Encrypted />,
    options: (v) => ({ encrypt: { userPassword: v.password || "secret" } }),
  },
];
