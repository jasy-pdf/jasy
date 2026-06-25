import { defineEventHandler, setResponseHeader, type H3Event } from "h3";
// Nitro's function cache, via Nuxt's server virtual - resolved at the app build, no nitropack direct dep.
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
   * Cache the rendered PDF with Nitro. `true` uses Nitro's defaults; pass an object for its cache options
   * (`maxAge`, `name`, `getKey`, `swr`, ...). The default key is the request path + query, so
   * `/api/invoice?id=123` caches per id without any extra work. (Caches on a Node runtime - uses Buffer.)
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

  // Nitro's cache serializes the cached value, which corrupts a raw binary body. So cache the bytes as a
  // base64 string (round-trips losslessly), then decode and set the headers fresh on every response.
  const renderCached = defineCachedFunction(
    async (event: H3Event) => {
      const bytes = await renderToBytes(await build(event), send.renderOptions);
      return Buffer.from(bytes).toString("base64");
    },
    { getKey: (event: H3Event) => event.path, ...(cache === true ? {} : cache) },
  );

  return defineEventHandler(async (event) => {
    const bytes = new Uint8Array(Buffer.from(await renderCached(event), "base64"));
    setPdfHeaders(event, send);
    return bytes;
  });
}
