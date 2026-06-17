import { PDFDocumentElement } from "../elements/pdf-document-element";
import { PageElement, PDFPageConfig } from "../elements/page-element";
import { PDFElement } from "../elements/pdf-element";
import { PageSize } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import { PDFDocument, PDFConfig } from "../renderer/pdf-document-class";
import { FontStyle } from "../utils/pdf-object-manager";
import { getArrayBuffer } from "../utils/utf8-to-windows1252-encoder";
import { Column, StackOptions } from "./layout";
import { Insets, toEdges } from "./insets";

/** A page size: a `PageSize` enum, or a friendly name like `"A4"` / `"letter"` (any case). */
export type PageSizeInput = PageSize | string;

const PAGE_SIZE_VALUES = new Set<string>(Object.values(PageSize));

function toPageSize(input: PageSizeInput): PageSize {
  const v = String(input).toLowerCase();
  if (!PAGE_SIZE_VALUES.has(v)) throw new Error(`Unknown page size: "${input}"`);
  return v as PageSize;
}

/** Default page margin (all sides, points) when a `Page` doesn't set one. */
const DEFAULT_MARGIN = 56;

export interface PageOptions extends StackOptions {
  /** Page size (default A4). */
  size?: PageSizeInput;
  orientation?: "portrait" | "landscape";
  /** Page margin (default 56pt all sides). */
  margin?: Insets;
  /** Laid out at the top, repeated on every physical page. */
  header?: PDFElement;
  /** Laid out at the bottom, repeated on every physical page. */
  footer?: PDFElement;
  // `gap` / `main` / `cross` (from StackOptions) tune the body Column the children sit in.
}

/**
 * One page template. `Page(children)` or `Page(opts, children)`. The children are stacked
 * (auto-wrapped in a `Column`, locked §6) inside the content box; `header`/`footer` repeat
 * on every physical page the content paginates onto.
 */
export function Page(children: PDFElement[]): PageElement;
export function Page(opts: PageOptions, children: PDFElement[]): PageElement;
export function Page(a: PageOptions | PDFElement[], b?: PDFElement[]): PageElement {
  const isOpts = !Array.isArray(a);
  const opts = (isOpts ? a : {}) as PageOptions;
  const children = (isOpts ? (b ?? []) : a) as PDFElement[];

  const [top, right, bottom, left] = toEdges(opts.margin ?? DEFAULT_MARGIN);
  const config: PDFPageConfig = {
    pageSize: opts.size !== undefined ? toPageSize(opts.size) : PageSize.A4,
    orientation: opts.orientation === "landscape" ? Orientation.landscape : Orientation.portrait,
    margin: { top, right, bottom, left },
  };

  return new PageElement({
    config,
    header: opts.header,
    footer: opts.footer,
    children: [Column({ gap: opts.gap, main: opts.main, cross: opts.cross }, children)],
  });
}

export interface DocumentOptions {
  /** PDF metadata. */
  meta?: { title?: string; author?: string };
}

// Document metadata is a document-render concern, not part of the element tree, so it is
// kept beside the returned element and picked up by `renderPdf`.
const docMeta = new WeakMap<PDFDocumentElement, DocumentOptions["meta"]>();

/** The document root. `Document(pages)` or `Document(opts, pages)`. */
export function Document(pages: PageElement[]): PDFDocumentElement;
export function Document(opts: DocumentOptions, pages: PageElement[]): PDFDocumentElement;
export function Document(
  a: DocumentOptions | PageElement[],
  b?: PageElement[],
): PDFDocumentElement {
  const isOpts = !Array.isArray(a);
  const opts = (isOpts ? a : {}) as DocumentOptions;
  const pages = (isOpts ? (b ?? []) : a) as PageElement[];

  const doc = new PDFDocumentElement({ children: pages });
  if (opts.meta) docMeta.set(doc, opts.meta);
  return doc;
}

export type FontBytes = Buffer | Uint8Array;

/** A font family: one `.ttf` per style. Only `normal` is required; `bold`/`italic`/`boldItalic`
 *  are picked up automatically by `Text({ bold, italic })`, falling back to `normal` if absent. */
export interface FontFamily {
  normal: FontBytes;
  bold?: FontBytes;
  italic?: FontBytes;
  boldItalic?: FontBytes;
}

/** A file to embed in the PDF as an associated file (PDF/A-3 / PDF 2.0). */
export interface Attachment {
  /** Display file name, e.g. `"factur-x.xml"`. */
  name: string;
  data: FontBytes;
  /** `/AFRelationship`, e.g. `"Data"` (ZUGFeRD), `"Source"`, `"Alternative"`. Default `"Unspecified"`. */
  relationship?: string;
  /** MIME type, e.g. `"text/xml"`. Default `"application/octet-stream"`. */
  mimeType?: string;
  description?: string;
}

export interface RenderOptions {
  /** Embedded TrueType fonts, keyed by the name used in `Text({ font })`. The value is either the
   *  raw `.ttf` bytes (registered as `normal`) or a `FontFamily` with per-style files. */
  fonts?: Record<string, FontBytes | FontFamily>;
  /** Files to embed as associated files (e.g. the ZUGFeRD `factur-x.xml`). */
  attachments?: Attachment[];
  /** Document XMP metadata packet (catalog `/Metadata`), e.g. PDF/A-3 + Factur-X. Keep it ASCII. */
  xmp?: string;
  /** ICC profile bytes for a PDF/A `/OutputIntent` (an RGB profile, e.g. sRGB). */
  outputIntent?: FontBytes;
  /** PDF header version, e.g. `"1.7"` for PDF/A-3 (default `"1.4"`). */
  pdfVersion?: string;
  /** Write a trailer `/ID` (required by PDF/A); the id is a deterministic content hash. */
  documentId?: boolean;
  /** Register the standard-14 fonts (default true). Set false for PDF/A so only embedded fonts
   *  appear — then every font name used must be supplied via `fonts`. */
  standardFonts?: boolean;
}

function isFontBytes(v: FontBytes | FontFamily): v is FontBytes {
  return Buffer.isBuffer(v) || v instanceof Uint8Array;
}

/** Renders a `Document(...)` tree to the raw PDF string. */
export async function renderPdf(doc: PDFDocumentElement, options?: RenderOptions): Promise<string> {
  const meta = docMeta.get(doc);
  const config: PDFConfig = {
    ...(meta ? { metaData: { title: meta.title, author: meta.author, keywords: [] } } : {}),
    ...(options?.standardFonts === false ? { registerStandardFonts: false } : {}),
  };
  const fonts = options?.fonts ?? {};
  const attachments = options?.attachments ?? [];

  // A throwaway PDFDocument whose build() yields this tree, reusing the engine's standard
  // font registration + config handling (the constructor does both). Custom fonts are
  // registered here, before layout/render, so both the metrics and the backend see them.
  const Anon = class extends PDFDocument {
    constructor() {
      super(config);
      const om = this.objectManager;
      for (const [name, value] of Object.entries(fonts)) {
        if (isFontBytes(value)) {
          om.registerCustomFont(name, Buffer.from(value));
        } else {
          om.registerCustomFont(name, Buffer.from(value.normal), FontStyle.Normal);
          if (value.bold) om.registerCustomFont(name, Buffer.from(value.bold), FontStyle.Bold);
          if (value.italic)
            om.registerCustomFont(name, Buffer.from(value.italic), FontStyle.Italic);
          if (value.boldItalic)
            om.registerCustomFont(name, Buffer.from(value.boldItalic), FontStyle.BoldItalic);
        }
      }
      for (const a of attachments) {
        om.attachFile(a.name, Buffer.from(a.data), {
          relationship: a.relationship,
          mimeType: a.mimeType,
          description: a.description,
        });
      }
      if (options?.xmp) om.setXmpMetadata(options.xmp);
      if (options?.outputIntent) om.setOutputIntent(Buffer.from(options.outputIntent));
      if (options?.pdfVersion) om.setPdfVersion(options.pdfVersion);
      if (options?.documentId) om.enableDocumentId();
    }
    build(): PDFDocumentElement {
      return doc;
    }
  };
  return Anon.render();
}

/** Renders a `Document(...)` tree to PDF bytes (e.g. for a download / save dialog). */
export async function renderToBytes(
  doc: PDFDocumentElement,
  options?: RenderOptions,
): Promise<Uint8Array> {
  return new Uint8Array(getArrayBuffer(await renderPdf(doc, options)));
}
