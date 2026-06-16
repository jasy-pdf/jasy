import { PDFDocumentElement } from "../elements/pdf-document-element";
import { PageElement, PDFPageConfig } from "../elements/page-element";
import { PDFElement } from "../elements/pdf-element";
import { PageSize } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import { PDFDocument, PDFConfig } from "../renderer/pdf-document-class";
import { getArrayBuffer } from "../utils/utf8-to-windows1252-encoder";
import { Column } from "./layout";
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

export interface PageOptions {
  /** Page size (default A4). */
  size?: PageSizeInput;
  orientation?: "portrait" | "landscape";
  /** Page margin (default 56pt all sides). */
  margin?: Insets;
  /** Laid out at the top, repeated on every physical page. */
  header?: PDFElement;
  /** Laid out at the bottom, repeated on every physical page. */
  footer?: PDFElement;
}

/**
 * One page template. `Page(children)` or `Page(opts, children)`. The children are stacked
 * (auto-wrapped in a `Column`, locked §6) inside the content box; `header`/`footer` repeat
 * on every physical page the content paginates onto.
 */
export function Page(children: PDFElement[]): PageElement;
export function Page(opts: PageOptions, children: PDFElement[]): PageElement;
export function Page(
  a: PageOptions | PDFElement[],
  b?: PDFElement[]
): PageElement {
  const isOpts = !Array.isArray(a);
  const opts = (isOpts ? a : {}) as PageOptions;
  const children = (isOpts ? b ?? [] : a) as PDFElement[];

  const [top, right, bottom, left] = toEdges(opts.margin ?? DEFAULT_MARGIN);
  const config: PDFPageConfig = {
    pageSize: opts.size !== undefined ? toPageSize(opts.size) : PageSize.A4,
    orientation:
      opts.orientation === "landscape"
        ? Orientation.landscape
        : Orientation.portrait,
    margin: { top, right, bottom, left },
  };

  return new PageElement({
    config,
    header: opts.header,
    footer: opts.footer,
    children: [Column(children)],
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
export function Document(
  opts: DocumentOptions,
  pages: PageElement[]
): PDFDocumentElement;
export function Document(
  a: DocumentOptions | PageElement[],
  b?: PageElement[]
): PDFDocumentElement {
  const isOpts = !Array.isArray(a);
  const opts = (isOpts ? a : {}) as DocumentOptions;
  const pages = (isOpts ? b ?? [] : a) as PageElement[];

  const doc = new PDFDocumentElement({ children: pages });
  if (opts.meta) docMeta.set(doc, opts.meta);
  return doc;
}

/** Renders a `Document(...)` tree to the raw PDF string. */
export async function renderPdf(doc: PDFDocumentElement): Promise<string> {
  const meta = docMeta.get(doc);
  const config: PDFConfig | undefined = meta
    ? { metaData: { title: meta.title, author: meta.author, keywords: [] } }
    : undefined;

  // A throwaway PDFDocument whose build() yields this tree, reusing the engine's standard
  // font registration + config handling (the constructor does both).
  const Anon = class extends PDFDocument {
    constructor() {
      super(config);
    }
    build(): PDFDocumentElement {
      return doc;
    }
  };
  return Anon.render();
}

/** Renders a `Document(...)` tree to PDF bytes (e.g. for a download / save dialog). */
export async function renderToBytes(doc: PDFDocumentElement): Promise<Uint8Array> {
  return new Uint8Array(getArrayBuffer(await renderPdf(doc)));
}
