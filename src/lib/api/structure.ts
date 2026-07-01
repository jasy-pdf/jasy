import { readFileBytes } from "../platform/node-fs.ts";
import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import { PageElement, PDFPageConfig } from "../elements/page-element.ts";
import { PDFElement } from "../elements/pdf-element.ts";
import { DefaultTextStyleElement } from "../elements/layout/default-text-style-element.ts";
import type { OverflowPolicy } from "../layout/fragmentation.ts";
import { PageSize } from "../constants/page-sizes.ts";
import { Orientation } from "../renderer/pdf-config.ts";
import { PDFDocument, PDFConfig } from "../renderer/pdf-document-class.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";
import { getArrayBuffer } from "../utils/utf8-to-windows1252-encoder.ts";
import { createSecurityHandler, type EncryptOptions } from "../crypto/security-handler.ts";
// Public types so users can name the encryption options.
export type { EncryptOptions, Permissions } from "../crypto/security-handler.ts";
import { uaXmp } from "../utils/ua-xmp.ts";
import { Column, StackOptions } from "./layout.ts";
import { Insets, toEdges } from "./insets.ts";
import { TextDefaults, toTextStyleOverride } from "./text.ts";

const MM_TO_PT = 72 / 25.4; // 1 mm in PDF points

/** A custom page size. Use the `mm()` helper for millimetres, or pass points directly. */
export interface CustomSize {
  width: number;
  height: number;
  unit?: "pt" | "mm";
}

/** Millimetres → a custom page size, e.g. a 50×65 mm label: `Page({ size: mm(50, 65) }, …)`. */
export function mm(width: number, height: number): CustomSize {
  return { width, height, unit: "mm" };
}

/** A page size: a named `PageSize`/string (`"A4"`, `"letter"`, any case), or a `CustomSize`. */
export type PageSizeInput = PageSize | string | CustomSize;

const PAGE_SIZE_VALUES = new Set<string>(Object.values(PageSize));

function toPageSize(input: PageSize | string): PageSize {
  const v = String(input).toLowerCase();
  if (!PAGE_SIZE_VALUES.has(v)) throw new Error(`Unknown page size: "${input}"`);
  return v as PageSize;
}

/** Resolve `size` into config fields: a named `pageSize`, or an explicit [width, height] in points. */
function resolveSize(
  input: PageSizeInput | undefined,
): Pick<PDFPageConfig, "pageSize" | "customSize"> {
  if (input !== undefined && typeof input === "object") {
    const f = input.unit === "mm" ? MM_TO_PT : 1;
    return { pageSize: PageSize.A4, customSize: [input.width * f, input.height * f] };
  }
  return { pageSize: input !== undefined ? toPageSize(input) : PageSize.A4 };
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
    ...resolveSize(opts.size),
    orientation: opts.orientation === "landscape" ? Orientation.landscape : Orientation.portrait,
    margin: { top, right, bottom, left },
  };

  return new PageElement({
    config,
    header: opts.header,
    footer: opts.footer,
    children: [Column({ gap: opts.gap, justify: opts.justify, align: opts.align }, children)],
  });
}

/** Document options: PDF metadata plus the inheritable text defaults (font, size, color, lineHeight,
 *  align, bold/italic) every `Text` inherits unless it sets its own - Flutter's `DefaultTextStyle`. */
export interface DocumentOptions extends TextDefaults {
  /** PDF metadata. */
  meta?: { title?: string; author?: string };
}

/** A single font file for `addFont`: a `.ttf` path (read on Node) or its raw bytes (e.g. a browser
 *  upload). */
export type FontFileSource = string | Uint8Array;

/** A styled font family for `addFont`: one file per style, only `normal` required. `Text({ bold,
 *  italic })` then picks the right face, falling back to `normal`. */
export interface FontFamilyInput {
  normal: FontFileSource;
  bold?: FontFileSource;
  italic?: FontFileSource;
  boldItalic?: FontFileSource;
}

/** What `addFont` accepts: one file (path or bytes), or a styled family. */
export type FontSource = FontFileSource | FontFamilyInput;

/** The object the `Document(...)` factory returns: the element tree plus a managed font registry. */
export interface JasyDocument extends PDFDocumentElement {
  /** Register a font under `name`, then use it via `Text({ font: name })`. The source is a `.ttf`
   *  path (read now, on Node), raw bytes, or a styled family. Re-adding a name overwrites it.
   *  A registered font that no `Text` actually uses is dropped at render and costs nothing. */
  addFont(name: string, source: FontSource): this;
  /** The names of the registered fonts. */
  getFonts(): string[];
  /** Whether a font is registered under `name`. */
  hasFont(name: string): boolean;
}

// Document metadata is a document-render concern, not part of the element tree, so it is
// kept beside the returned element and picked up by `renderPdf`.
const docMeta = new WeakMap<PDFDocumentElement, DocumentOptions["meta"]>();

// Fonts registered via doc.addFont(...), kept beside the element (like meta) and registered on the
// object manager at render time. Path sources are read to bytes in addFont, so the map holds bytes.
const docFonts = new WeakMap<PDFDocumentElement, Map<string, FontBytes | FontFamily>>();

/** Reads any path sources to bytes, leaving bytes / families as-is. */
function resolveFontSource(source: FontSource): FontBytes | FontFamily {
  const read = (s: FontFileSource): FontBytes => (typeof s === "string" ? readFileBytes(s) : s);
  if (typeof source === "string" || source instanceof Uint8Array) {
    return read(source);
  }
  const family: FontFamily = { normal: read(source.normal) };
  if (source.bold) family.bold = read(source.bold);
  if (source.italic) family.italic = read(source.italic);
  if (source.boldItalic) family.boldItalic = read(source.boldItalic);
  return family;
}

/** The document root. `Document(pages)` or `Document(opts, pages)`. */
export function Document(pages: PageElement[]): JasyDocument;
export function Document(opts: DocumentOptions, pages: PageElement[]): JasyDocument;
export function Document(a: DocumentOptions | PageElement[], b?: PageElement[]): JasyDocument {
  const isOpts = !Array.isArray(a);
  const opts = (isOpts ? a : {}) as DocumentOptions;
  const pages = (isOpts ? (b ?? []) : a) as PageElement[];

  const doc = new PDFDocumentElement({
    children: pages,
    defaultTextStyle: toTextStyleOverride(opts),
  }) as JasyDocument;
  if (opts.meta) docMeta.set(doc, opts.meta);

  // Managed font registry: addFont registers, getFonts/hasFont query, render reads it (below).
  const registry = new Map<string, FontBytes | FontFamily>();
  docFonts.set(doc, registry);
  doc.addFont = (name, source) => {
    registry.set(name, resolveFontSource(source));
    return doc;
  };
  doc.getFonts = () => [...registry.keys()];
  doc.hasFont = (name) => registry.has(name);

  return doc;
}

/**
 * Sets default text properties (font/size/color/lineHeight/align/weight) for a whole subtree -
 * Flutter's `DefaultTextStyle`, the per-section counterpart to the `Document` defaults. Children
 * inherit them unless they set their own, and they layer onto whatever is inherited from above.
 * `DefaultTextStyle(opts, children)`.
 */
export function DefaultTextStyle(
  opts: TextDefaults,
  children: PDFElement[],
): DefaultTextStyleElement {
  return new DefaultTextStyleElement({ style: toTextStyleOverride(opts), child: Column(children) });
}

export type FontBytes = Uint8Array;

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
   *  appear - then every font name used must be supplied via `fonts`. */
  standardFonts?: boolean;
  /** FlateDecode-compress the streams (default true). Set false for a greppable, uncompressed PDF. */
  compress?: boolean;
  /** What to do when content is taller than a page and cannot break: `"error"` throws (default),
   *  `"warn"` logs and clips, `"ignore"` clips silently. It is always clipped either way. */
  onOverflow?: OverflowPolicy;
  /** Encrypt the PDF with a password (AES-256, the newest standard). NOT compatible with PDF/A
   *  (ZUGFeRD invoices) - encrypting one throws, since PDF/A forbids encryption. */
  encrypt?: EncryptOptions;
  /** Emit an accessible, tagged PDF (structure tree for screen readers). */
  accessible?: boolean;
  /** Document language for accessibility, e.g. `"en-US"` / `"de-DE"` (default `"en-US"`). */
  lang?: string;
  /** Document title (used by accessible readers; also good metadata). */
  title?: string;
}

function isFontBytes(v: FontBytes | FontFamily): v is FontBytes {
  return v instanceof Uint8Array;
}

/** Renders a `Document(...)` tree to the raw PDF string. */
export async function renderPdf(doc: PDFDocumentElement, options?: RenderOptions): Promise<string> {
  const meta = docMeta.get(doc);
  const config: PDFConfig = {
    ...(meta ? { metaData: { title: meta.title, author: meta.author, keywords: [] } } : {}),
    ...(options?.standardFonts === false ? { registerStandardFonts: false } : {}),
  };
  // Fonts registered via doc.addFont(...) plus any passed in options (options win on a name clash).
  const registered = docFonts.get(doc);
  const fonts: Record<string, FontBytes | FontFamily> = {
    ...Object.fromEntries(registered ?? []),
    ...options?.fonts,
  };
  const attachments = options?.attachments ?? [];
  // The security handler's key derivation is async (WebCrypto), so build it here, before the sync
  // PDFDocument constructor wires it into the object manager.
  const securityHandler = options?.encrypt
    ? await createSecurityHandler(options.encrypt)
    : undefined;

  // A throwaway PDFDocument whose build() yields this tree, reusing the engine's standard
  // font registration + config handling (the constructor does both). Custom fonts are
  // registered here, before layout/render, so both the metrics and the backend see them.
  const Anon = class extends PDFDocument {
    constructor() {
      super(config);
      const om = this.objectManager;
      om.setCompress(options?.compress !== false); // FlateDecode streams by default
      om.setOverflowPolicy(options?.onOverflow ?? "error");
      for (const [name, value] of Object.entries(fonts)) {
        if (isFontBytes(value)) {
          om.registerCustomFont(name, value);
        } else {
          om.registerCustomFont(name, value.normal, FontStyle.Normal);
          if (value.bold) om.registerCustomFont(name, value.bold, FontStyle.Bold);
          if (value.italic) om.registerCustomFont(name, value.italic, FontStyle.Italic);
          if (value.boldItalic) om.registerCustomFont(name, value.boldItalic, FontStyle.BoldItalic);
        }
      }
      for (const a of attachments) {
        om.attachFile(a.name, a.data, {
          relationship: a.relationship,
          mimeType: a.mimeType,
          description: a.description,
        });
      }
      if (options?.xmp) om.setXmpMetadata(options.xmp);
      if (options?.outputIntent) om.setOutputIntent(options.outputIntent);
      if (options?.pdfVersion) om.setPdfVersion(options.pdfVersion);
      if (options?.documentId) om.enableDocumentId();
      if (securityHandler) om.setSecurityHandler(securityHandler);
      if (options?.accessible) {
        om.struct.enabled = true;
        if (options.lang) om.struct.lang = options.lang;
        if (options.title) om.struct.title = options.title;
        // Declare PDF/UA-1 in the XMP metadata, unless the caller supplied their own packet.
        if (!options.xmp) om.setXmpMetadata(uaXmp({ title: options.title, lang: options.lang }));
      }
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
): Promise<Uint8Array<ArrayBuffer>> {
  // Plain ArrayBuffer-backed, so the bytes drop straight into a Blob/Response (BlobPart needs <ArrayBuffer>).
  return new Uint8Array(getArrayBuffer(await renderPdf(doc, options)));
}
