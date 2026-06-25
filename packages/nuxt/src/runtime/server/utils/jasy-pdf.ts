import { defineEventHandler, setResponseHeader, type H3Event } from "h3";
// from #imports - nitropack isn't a direct dep.
import { defineCachedFunction } from "#imports";
import { renderToBytes, type RenderOptions } from "@jasy/pdf";

type PdfDoc = Parameters<typeof renderToBytes>[0];

export interface SendPdfOptions {
  /** Suggested file name. Default "document.pdf". */
  filename?: string;
  /** Send as a download (attachment) instead of inline. Default false. */
  download?: boolean;
  /** Engine options forwarded to renderToBytes (e.g. onOverflow). */
  renderOptions?: RenderOptions;
}

export interface PdfHandlerOptions extends SendPdfOptions {
  /**
   * Cache the rendered PDF with Nitro. `true` for defaults, or pass its cache options (`maxAge`, `name`,
   * `getKey`, `swr`, ...). Default key is path + query (so `/x?id=1` caches per id); `swr` defaults to
   * false. Node runtime.
   */
  cache?: boolean | Record<string, any>;
}

function setPdfHeaders(event: H3Event, options: SendPdfOptions) {
  setResponseHeader(event, "content-type", "application/pdf");
  setResponseHeader(
    event,
    "content-disposition",
    `${options.download ? "attachment" : "inline"}; filename="${options.filename ?? "document.pdf"}"`,
  );
}

/** Render a @jasy/pdf document and write it as the response (sets the PDF headers), returns the bytes. */
export async function sendPdf(
  event: H3Event,
  doc: PdfDoc,
  options: SendPdfOptions = {},
): Promise<Uint8Array> {
  const bytes = await renderToBytes(doc, options.renderOptions);
  setPdfHeaders(event, options);
  return bytes;
}

/** A PDF endpoint in one line: build a document from the request, get a streaming application/pdf route. */
export function definePdfHandler(
  build: (event: H3Event) => PdfDoc | Promise<PdfDoc>,
  options: PdfHandlerOptions = {},
) {
  const { cache, ...send } = options;

  if (!cache) {
    return defineEventHandler(async (event) => sendPdf(event, await build(event), send));
  }

  // Nitro's cache mangles a raw binary body, so cache base64 (lossless); decode + set headers fresh per response.
  const renderCached = defineCachedFunction(
    async (event: H3Event) => {
      const bytes = await renderToBytes(await build(event), send.renderOptions);
      return Buffer.from(bytes).toString("base64");
    },
    // swr:false - never serve a stale (e.g. hour-old) invoice; re-render once the entry expires.
    { swr: false, getKey: (event: H3Event) => event.path, ...(cache === true ? {} : cache) },
  );

  return defineEventHandler(async (event) => {
    const bytes = new Uint8Array(Buffer.from(await renderCached(event), "base64"));
    setPdfHeaders(event, send);
    return bytes;
  });
}
