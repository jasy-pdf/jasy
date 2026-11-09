import {
  EnvironmentInjector,
  InjectionToken,
  LOCALE_ID,
  PLATFORM_ID,
  inject,
  runInInjectionContext,
} from "@angular/core";
import { renderToBytes, type FontFamily, type RenderOptions } from "@jasy/pdf";
import { JASY_CONFIG, type FontFile, type FontInput } from "./config.js";
import type { PdfDocumentFn } from "./document.js";
import { bytesLoader } from "./load.js";

/** Turns your documents into PDFs. `inject(JasyPdf)` anywhere in an injection context. */
export interface JasyPdf {
  /** The PDF bytes. Works in the browser and on the server. */
  render<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<Uint8Array>;
  /** The PDF as a `Blob`, ready for an upload or `URL.createObjectURL`. */
  blob<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<Blob>;
  /** Saves the PDF in the browser under `filename`. */
  download<T>(
    document: PdfDocumentFn<T>,
    data: T,
    filename?: string,
    options?: RenderOptions,
  ): Promise<void>;
  /** Saves a finished PDF - a filled form, say - in the browser under `filename`. */
  download(pdf: Uint8Array | Blob, filename?: string): Promise<void>;
  /** Opens the PDF in a new tab. Call it from a click handler, or the browser blocks the tab. */
  open<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions): Promise<void>;
  /** Opens a finished PDF in a new tab. Call it from a click handler, or the browser blocks the tab. */
  open(pdf: Uint8Array | Blob): Promise<void>;
}

type Pdf = Uint8Array | Blob;
type DocumentArgs = [document: PdfDocumentFn<unknown>, data: unknown, ...rest: unknown[]];

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

export const JasyPdf = new InjectionToken<JasyPdf>("JasyPdf", {
  providedIn: "root",
  factory: createJasyPdf,
});

const PDF = "application/pdf";

function createJasyPdf(): JasyPdf {
  const injector = inject(EnvironmentInjector);
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

  async function render<T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions) {
    const doc = await runInInjectionContext(injector, () => document(data));
    return renderToBytes(doc, {
      lang: locale,
      ...config.defaults,
      ...options,
      fonts: { ...(await configuredFonts()), ...options?.fonts },
    });
  }
  const blob = async <T>(document: PdfDocumentFn<T>, data: T, options?: RenderOptions) =>
    asBlob(await render(document, data, options));
  const asBlob = (pdf: Pdf) =>
    pdf instanceof Blob ? pdf : new Blob([pdf as Uint8Array<ArrayBuffer>], { type: PDF });
  // A finished PDF, or a document with its data and render options.
  const isFinished = (args: unknown[]): args is [Pdf, ...unknown[]] =>
    typeof args[0] !== "function";

  return {
    render,
    blob,
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
      try {
        const file = isFinished(args)
          ? asBlob(args[0])
          : await blob(args[0], args[1], args[2] as RenderOptions);
        // Not revoked: the new tab is still loading it. It is freed when this page unloads.
        const url = URL.createObjectURL(file);
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
  };
}
