import type { Component } from "vue";
import type { RenderOptions } from "@jasy/pdf";
import Hello from "./Hello.vue";
import Invoice from "./Invoice.vue";
import Report from "./Report.vue";
import Invitation from "./Invitation.vue";
import Newspaper from "./Newspaper.vue";
import Layout from "./Layout.vue";
import Typography from "./Typography.vue";
import Drawing from "./Drawing.vue";
import Showcase from "./Showcase.vue";
import Transparency from "./Transparency.vue";
import Form from "./Form.vue";
import Encrypted from "./Encrypted.vue";
import helloSource from "./Hello.vue?raw";
import invoiceSource from "./Invoice.vue?raw";
import reportSource from "./Report.vue?raw";
import invitationSource from "./Invitation.vue?raw";
import newspaperSource from "./Newspaper.vue?raw";
import layoutSource from "./Layout.vue?raw";
import typographySource from "./Typography.vue?raw";
import drawingSource from "./Drawing.vue?raw";
import showcaseSource from "./Showcase.vue?raw";
import transparencySource from "./Transparency.vue?raw";
import formSource from "./Form.vue?raw";
import encryptedSource from "./Encrypted.vue?raw";

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
  file: string;
  source: string;
  component: Component;
  controls?: Control[];
  /** The asset files this sample needs; only these are loaded for it, and only these are in `assets`. */
  assets?: (keyof Assets)[];
  /** The props the component gets: the control values, plus the assets it asked for. */
  props?: (values: Values, assets: Assets) => Record<string, unknown>;
  options?: (values: Values) => RenderOptions;
}

export const SAMPLES: Sample[] = [
  {
    id: "hello",
    group: "Start",
    title: "Hello world",
    look: "A component tree becomes a PDF. Change the name.",
    file: "Hello.vue",
    source: helloSource,
    component: Hello,
    controls: [{ key: "name", label: "Name", type: "text", initial: "world" }],
    props: (v) => ({ name: v.name }),
  },
  {
    id: "invoice",
    group: "Documents",
    title: "Invoice",
    look: "Add lines: the table breaks across pages, its header row repeats.",
    file: "Invoice.vue",
    source: invoiceSource,
    component: Invoice,
    controls: [
      { key: "customer", label: "Bill to", type: "text", initial: "Max Mustermann, Berlin" },
      { key: "lines", label: "Lines", type: "range", initial: 3, min: 1, max: 60 },
    ],
    props: (v) => ({ customer: v.customer, lines: v.lines }),
  },
  {
    id: "report",
    group: "Documents",
    title: "Report",
    look: "Header and footer repeat; from page 2 the header says so.",
    file: "Report.vue",
    source: reportSource,
    component: Report,
    controls: [{ key: "sections", label: "Sections", type: "range", initial: 7, min: 1, max: 40 }],
    props: (v) => ({ sections: v.sections }),
  },
  {
    id: "invitation",
    group: "Documents",
    title: "Invitation",
    look: "A5, full bleed: Expanded fills the page.",
    file: "Invitation.vue",
    source: invitationSource,
    component: Invitation,
  },
  {
    id: "newspaper",
    group: "Documents",
    title: "Newspaper",
    look: "Balanced columns, then a Flow through a page layout of your own.",
    file: "Newspaper.vue",
    source: newspaperSource,
    component: Newspaper,
  },
  {
    id: "layout",
    group: "jasy's power",
    title: "Layout",
    look: "Flex, wrap, align-self, z-index, a rotated stamp, gradients.",
    file: "Layout.vue",
    source: layoutSource,
    component: Layout,
  },
  {
    id: "typography",
    group: "jasy's power",
    title: "Typography",
    look: "Kerning, spans, justification, ellipsis, spacing.",
    file: "Typography.vue",
    source: typographySource,
    component: Typography,
  },
  {
    id: "drawing",
    group: "jasy's power",
    title: "Drawing",
    look: "A chart painted from data, transforms, inline SVG.",
    file: "Drawing.vue",
    source: drawingSource,
    component: Drawing,
  },
  {
    id: "fonts",
    group: "jasy's power",
    title: "Fonts and images",
    look: "A custom .ttf and a photo, both as bytes from the browser.",
    file: "Showcase.vue",
    source: showcaseSource,
    component: Showcase,
    assets: ["font", "photo"],
    props: (_, a) => ({ font: a.font, image: a.photo }),
  },
  {
    id: "transparency",
    group: "jasy's power",
    title: "Transparency",
    look: "A PNG's alpha channel over colored panels.",
    file: "Transparency.vue",
    source: transparencySource,
    component: Transparency,
    assets: ["logo"],
    props: (_, a) => ({ logo: a.logo }),
  },
  {
    id: "form",
    group: "jasy's power",
    title: "Form",
    look: "Real form fields: click into the PDF and type.",
    file: "Form.vue",
    source: formSource,
    component: Form,
    controls: [{ key: "name", label: "Full name", type: "text", initial: "Ada Lovelace" }],
    props: (v) => ({ name: v.name }),
  },
  {
    id: "encrypted",
    group: "jasy's power",
    title: "Encrypted",
    look: "AES-256: the viewer asks for the password.",
    file: "Encrypted.vue",
    source: encryptedSource,
    component: Encrypted,
    controls: [{ key: "password", label: "Password", type: "text", initial: "secret" }],
    options: (v) => ({ encrypt: { userPassword: v.password || "secret" } }),
  },
];
