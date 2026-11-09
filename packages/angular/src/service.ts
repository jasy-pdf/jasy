import {
  EnvironmentInjector,
  InjectionToken,
  type Injector,
  LOCALE_ID,
  PLATFORM_ID,
  inject,
  runInInjectionContext,
} from "@angular/core";
import type { FontFamily, RenderOptions } from "@jasy/pdf";
import { JASY_CONFIG, type FontFile, type FontInput } from "./config.js";
import type { PdfDocumentFn } from "./document.js";
import { bytesLoader } from "./load.js";

/**
 * Turns your documents into PDFs. `inject(JasyPdf)` anywhere in an injection context. A document runs
 * in the app's root injector here; in a `pdfResource`, in the injector of the component that owns it.
 * A document without data (`PdfDocumentFn` with no type argument) needs none: `render(doc)`.
 */
export interface JasyPdf {
  /** The PDF bytes. Works in the browser and on the server. */
  render(document: PdfDocumentFn, data?: undefined, options?: RenderOptions): Promise<Uint8Array>;
  render<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<Uint8Array>;
  /** The PDF as a `Blob`, ready for an upload or `URL.createObjectURL`. */
  blob(document: PdfDocumentFn, data?: undefined, options?: RenderOptions): Promise<Blob>;
  blob<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<Blob>;
  /** Saves the PDF in the browser under `filename`. */
  download(
    document: PdfDocumentFn,
    data?: undefined,
    filename?: string,
    options?: RenderOptions,
  ): Promise<void>;
  download<T>(
    document: PdfDocumentFn<T>,
    data: T,
    filename?: string,
    options?: RenderOptions,
  ): Promise<void>;
  /** Saves a finished PDF - a filled form, say - in the browser under `filename`. */
  download(pdf: Uint8Array | Blob, filename?: string): Promise<void>;
  /**
   * Opens the PDF in a new tab. Call it from a click handler: a browser blocks a tab opened later, and
   * then this throws a `JasyPopupBlockedError`.
   */
  open(document: PdfDocumentFn, data?: undefined, options?: RenderOptions): Promise<void>;
  open<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<void>;
  /** Opens a finished PDF in a new tab, under the same rule. */
  open(pdf: Uint8Array | Blob): Promise<void>;
  /**
   * Loads what the first PDF would wait for: the standard font metrics and the fonts of `provideJasy`.
   * `provideJasy({ preload: true })` calls it once the app is idle; call it yourself to warm up on a
   * hover, say.
   */
  preload(): Promise<void>;
}

type Pdf = Uint8Array | Blob;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any document, typed by the overloads above
type DocumentArgs = [document: PdfDocumentFn<any>, data?: unknown, ...rest: unknown[]];

/** Thrown by `download()` and `open()` outside a browser, where there is no tab to save into. */
export class JasyBrowserOnlyError extends Error {
  constructor(method: string) {
    super(
      `JasyPdf.${method}() needs a browser. On the server, use render() and send the bytes - ` +
        `e.g. with the content type "application/pdf".`,
    );
    this.name = "JasyBrowserOnlyError";
  }
}

/** Thrown by `open()` when the browser refused the new tab - it was not called from a click. */
export class JasyPopupBlockedError extends Error {
  constructor() {
    super(
      "The browser blocked the new tab. Call JasyPdf.open() straight from a click handler, " +
        "or save the PDF with download() instead.",
    );
    this.name = "JasyPopupBlockedError";
  }
}

/** Renders in a given injector - how a pdfResource runs its document in its component. Internal. */
export const RENDER_IN = Symbol("jasy.renderIn");
export type RenderIn = <T>(
  injector: Injector,
  document: PdfDocumentFn<T>,
  data: T,
  options?: RenderOptions,
) => Promise<Uint8Array>;

export const JasyPdf = new InjectionToken<JasyPdf>("JasyPdf", {
  providedIn: "root",
  factory: createJasyPdf,
});

const PDF = "application/pdf";

// The engine is imported with the first PDF, not at the top: everything here is reachable from the
// package index, which app.config.ts imports for provideJasy() - a static import would put the whole
// engine into the start bundle, @defer or not. A failed load (a chunk lost to a deploy) is retried.
let engine: Promise<typeof import("@jasy/pdf")> | undefined;
const loadEngine = () =>
  (engine ??= import("@jasy/pdf").catch((e) => {
    engine = undefined;
    throw e;
  }));

function createJasyPdf(): JasyPdf & { [RENDER_IN]: RenderIn } {
  const root = inject(EnvironmentInjector);
  const config = inject(JASY_CONFIG);
  const locale = inject(LOCALE_ID);
  const browser = inject(PLATFORM_ID) === "browser";

  const load = bytesLoader();

  // One request per font file for the app's lifetime; a failed one is forgotten, so the next PDF retries.
  const files = new Map<string, Promise<Uint8Array>>();
  const file = (f: FontFile): Promise<Uint8Array> => {
    if (typeof f !== "string") return Promise.resolve(f);
    let bytes = files.get(f);
    if (!bytes) {
      bytes = load(f);
      bytes.catch(() => files.delete(f));
      files.set(f, bytes);
    }
    return bytes;
  };
  const font = async (f: FontInput): Promise<Uint8Array | FontFamily> => {
    if (typeof f === "string" || f instanceof Uint8Array) return file(f);
    const [normal, bold, italic, boldItalic] = await Promise.all(
      [f.normal, f.bold, f.italic, f.boldItalic].map((s) => (s ? file(s) : undefined)),
    );
    return { normal: normal!, bold, italic, boldItalic };
  };
  let fonts: Promise<RenderOptions["fonts"]> | undefined;
  const configuredFonts = () =>
    (fonts ??= Promise.all(
      Object.entries(config.fonts ?? {}).map(async ([name, f]) => [name, await font(f)] as const),
    ).then(Object.fromEntries, (e) => {
      fonts = undefined;
      throw e;
    }));

  const renderIn: RenderIn = async (injector, document, data, options) => {
    const doc = await runInInjectionContext(injector, () => document(data));
    const { renderToBytes } = await loadEngine();
    return renderToBytes(doc, {
      lang: locale,
      ...config.defaults,
      ...options,
      fonts: { ...(await configuredFonts()), ...options?.fonts },
    });
  };
  const render = <T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions) =>
    renderIn(root, document, data, options);
  const blob = async <T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions) =>
    asBlob(await render(document, data, options));
  const asBlob = (pdf: Pdf) =>
    pdf instanceof Blob ? pdf : new Blob([pdf as Uint8Array<ArrayBuffer>], { type: PDF });
  // A finished PDF, or a document with its data and render options.
  const isFinished = (args: unknown[]): args is [Pdf, ...unknown[]] =>
    typeof args[0] !== "function";

  return {
    [RENDER_IN]: renderIn,
    render,
    blob,
    async preload() {
      await Promise.all([loadEngine().then((e) => e.preloadStandardFonts()), configuredFonts()]);
    },
    async download(...args: [Pdf, string?] | DocumentArgs) {
      if (!browser) throw new JasyBrowserOnlyError("download");
      const [file, filename = "document.pdf"] = isFinished(args)
        ? [asBlob(args[0]), args[1] as string | undefined]
        : [await blob(args[0], args[1], args[3] as RenderOptions), args[2] as string | undefined];
      const url = URL.createObjectURL(file);
      const a = Object.assign(globalThis.document.createElement("a"), {
        href: url,
        download: filename,
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async open(...args: [Pdf] | DocumentArgs) {
      if (!browser) throw new JasyBrowserOnlyError("open");
      // Opened before the render, still inside the click: a tab opened after an await is a popup.
      const tab = window.open("", "_blank");
      if (!tab) throw new JasyPopupBlockedError();
      try {
        const file = isFinished(args)
          ? asBlob(args[0])
          : await blob(args[0], args[1], args[2] as RenderOptions);
        // Not revoked: the new tab is still loading it. It is freed when this page unloads.
        tab.location.href = URL.createObjectURL(file);
      } catch (e) {
        tab.close();
        throw e;
      }
    },
  };
}
