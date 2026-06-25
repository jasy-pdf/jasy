import { defineEventHandler, setResponseHeader, type H3Event } from "h3";
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

/** Render a @jasy/pdf document and write it as the response (sets the PDF headers), returns the bytes. */
export async function sendPdf(
  event: H3Event,
  doc: PdfDoc,
  options: SendPdfOptions = {},
): Promise<Uint8Array> {
  const bytes = await renderToBytes(doc, options.renderOptions);
  setResponseHeader(event, "content-type", "application/pdf");
  setResponseHeader(
    event,
    "content-disposition",
    `${options.download ? "attachment" : "inline"}; filename="${options.filename ?? "document.pdf"}"`,
  );
  return bytes;
}

/** A PDF endpoint in one line: build a document from the request, get a streaming application/pdf route. */
export function definePdfHandler(
  build: (event: H3Event) => PdfDoc | Promise<PdfDoc>,
  options: SendPdfOptions = {},
) {
  return defineEventHandler(async (event) => sendPdf(event, await build(event), options));
}
