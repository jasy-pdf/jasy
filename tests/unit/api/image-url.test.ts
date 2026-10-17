import { describe, it, expect, afterEach, vi } from "vitest";
import { Document, Page, Image, renderToBytes } from "../../../src/lib/api/index.ts";
import { ImageUrlError, type ImageElement } from "../../../src/lib/elements/image-element.ts";

// An image from a URL is fetched when the document renders, with the same timeout and size ceiling as a
// font from a URL. What it is comes from its bytes, never from the address. `fetch` is stubbed: no test
// may reach the network - except a `data:` URL, which never leaves the process.

// A valid 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==";
const PNG = new Uint8Array(Buffer.from(PNG_BASE64, "base64"));

const stubFetch = (respond: () => Response) => {
  const fetch = vi.fn(() => Promise.resolve(respond()));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
const ok = (bytes: Uint8Array) =>
  ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }) as unknown as Response;
const status = (code: number) => ({ ok: false, status: code }) as unknown as Response;

const pdfOf = async (image: ReturnType<typeof Image>) =>
  new TextDecoder("latin1").decode(
    await renderToBytes(Document([Page([image])]), { compress: false }),
  );

afterEach(() => vi.unstubAllGlobals());

describe("an image from a URL", () => {
  it("is fetched once and embedded - the address says nothing about the format", async () => {
    const fetch = stubFetch(() => ok(PNG));
    const pdf = await pdfOf(Image("https://x.example/photo?id=7", { width: 20 }));
    expect(pdf).toMatch(/\/Subtype \/Image/);
    // The size pass before layout and the renderer share one fetch.
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("takes its aspect ratio from the fetched bytes", async () => {
    stubFetch(() => ok(PNG));
    const image = Image("https://x.example/dot.png", { width: 20 }) as ImageElement;
    await pdfOf(image);
    expect(image.getProps().height).toBe(20); // 1x1 pixels
  });

  it("reads a data: URL without the network", async () => {
    const pdf = await pdfOf(Image(`data:image/png;base64,${PNG_BASE64}`, { width: 20 }));
    expect(pdf).toMatch(/\/Subtype \/Image/);
  });
});

describe("a broken image link stops the render, naming the URL", () => {
  it("says which status came back", async () => {
    stubFetch(() => status(404));
    const render = pdfOf(Image("https://x.example/gone.png"));
    await expect(render).rejects.toBeInstanceOf(ImageUrlError);
    await expect(pdfOf(Image("https://x.example/gone.png"))).rejects.toThrow(
      /image at https:\/\/x\.example\/gone\.png could not be fetched: HTTP 404/,
    );
  });

  it("names an HTML page answered with a 200 instead of failing inside the decoder", async () => {
    stubFetch(() => ok(new TextEncoder().encode("<!DOCTYPE html><title>Not found</title>")));
    await expect(pdfOf(Image("https://x.example/logo.png"))).rejects.toThrow(
      /https:\/\/x\.example\/logo\.png is markup .* PNG and JPEG/,
    );
  });
});

describe("an image file that cannot be read", () => {
  it("says which file, instead of a later 'call loadAndConvertImage first'", async () => {
    await expect(pdfOf(Image("/nonexistent/jasy-test.png"))).rejects.toThrow(
      /could not read the image at \/nonexistent\/jasy-test\.png/,
    );
  });
});
