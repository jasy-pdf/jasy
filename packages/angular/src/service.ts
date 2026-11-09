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
import type { PdfDocument } from "./document.js";

/** Turns your documents into PDFs. `inject(JasyPdf)` anywhere in an injection context. */
export interface JasyPdf {
  /** The PDF bytes. Works in the browser and on the server. */
  render<T>(document: PdfDocument<T>, data: T, options?: RenderOptions): Promise<Uint8Array>;
  /** The PDF as a `Blob`, ready for an upload or `URL.createObjectURL`. */
  blob<T>(document: PdfDocument<T>, data: T, options?: RenderOptions): Promise<Blob>;
  /** Saves the PDF in the browser under `filename`. */
  download<T>(
    document: PdfDocument<T>,
    data: T,
    filename?: string,
    options?: RenderOptions,
  ): Promise<void>;
  /** Opens the PDF in a new tab. Call it from a click handler, or the browser blocks the tab. */
  open<T>(document: PdfDocument<T>, data: T, options?: RenderOptions): Promise<void>;
}

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

  // One fetch per font file for the app's lifetime; a failed one is forgotten, so the next PDF retries.
  const files = new Map<string, Promise<Uint8Array>>();
  const file = (f: FontFile): Promise<Uint8Array> => {
    if (typeof f !== "string") return Promise.resolve(f);
    let bytes = files.get(f);
    if (!bytes) {
      bytes = fetch(f).then(async (r) => {
        if (!r.ok) throw new Error(`jasy could not load the font ${f}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      });
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

  async function render<T>(document: PdfDocument<T>, data: T, options?: RenderOptions) {
    const doc = await runInInjectionContext(injector, () => document(data));
    return renderToBytes(doc, {
      lang: locale,
      ...config.defaults,
      ...options,
      fonts: { ...(await configuredFonts()), ...options?.fonts },
    });
  }
  const blob = async <T>(document: PdfDocument<T>, data: T, options?: RenderOptions) =>
    new Blob([(await render(document, data, options)) as Uint8Array<ArrayBuffer>], { type: PDF });

  return {
    render,
    blob,
    async download(document, data, filename = "document.pdf", options) {
      if (!browser) throw new JasyBrowserOnlyError("download");
      const url = URL.createObjectURL(await blob(document, data, options));
      const a = Object.assign(globalThis.document.createElement("a"), {
        href: url,
        download: filename,
      });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    async open(document, data, options) {
      if (!browser) throw new JasyBrowserOnlyError("open");
      // Opened before the render, still inside the click: a tab opened after an await is a popup.
      const tab = window.open("", "_blank");
      try {
        // Not revoked: the new tab is still loading it. It is freed when this page unloads.
        const url = URL.createObjectURL(await blob(document, data, options));
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
  };
}
