import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Document,
  Page,
  Image,
  Svg,
  PageBuilder,
  renderToBytes,
} from "../../../src/lib/api/index.ts";
import { SvgElement } from "../../../src/lib/elements/svg-element.ts";
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
// A 2:1 drawing.
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';
const text = (t: string) => new TextEncoder().encode(t);

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

describe("an SVG from a URL", () => {
  it("is fetched once, stays a vector, and takes its ratio from the drawing", async () => {
    const fetch = stubFetch(() => ok(text(SVG)));
    const svg = Image("https://x.example/logo.svg?v=2", { width: 40 });
    expect(svg).toBeInstanceOf(SvgElement);
    const pdf = await pdfOf(svg);
    expect(pdf).not.toMatch(/\/Subtype \/Image/);
    expect((svg as SvgElement).getProps().height).toBe(20);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads a data:image/svg+xml URL without the network", async () => {
    const svg = Image(`data:image/svg+xml,${encodeURIComponent(SVG)}`, { width: 40 });
    expect(svg).toBeInstanceOf(SvgElement);
    await pdfOf(svg);
    expect((svg as SvgElement).getProps().height).toBe(20);
  });

  it("is drawn when it sits in a subtree built during layout", async () => {
    stubFetch(() => ok(text(SVG)));
    const pdf = new TextDecoder("latin1").decode(
      await renderToBytes(
        Document([
          Page([PageBuilder(() => Svg("https://x.example/logo.svg", { width: 40, height: 20 }))]),
        ]),
        { compress: false },
      ),
    );
    expect(pdf).toMatch(/\bre\b|\bm\b/); // the rectangle's path
  });

  it("asks for its whole box when it sits in content built during layout", async () => {
    stubFetch(() => ok(text(SVG)));
    const inBuilder = (opts: { width?: number; height?: number; aspectRatio?: number }) =>
      renderToBytes(Document([Page([PageBuilder(() => Svg("https://x.example/logo.svg", opts))])]));
    await expect(inBuilder({ width: 40 })).rejects.toThrow(
      /built during layout .* width and a height/,
    );
    await expect(inBuilder({ width: 40, aspectRatio: 2 })).resolves.toBeInstanceOf(Uint8Array);
  });

  it("stops the render naming the URL when the link is dead or the file is no SVG", async () => {
    stubFetch(() => status(404));
    await expect(pdfOf(Image("https://x.example/gone.svg"))).rejects.toThrow(
      /SVG at https:\/\/x\.example\/gone\.svg could not be fetched: HTTP 404/,
    );
    stubFetch(() => ok(PNG));
    await expect(pdfOf(Image("https://x.example/logo.svg"))).rejects.toThrow(
      /SVG at https:\/\/x\.example\/logo\.svg could not be read/,
    );
  });
});

describe("a failed fetch is not kept", () => {
  it("is tried once per render, and again on the next render of the same document", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(++calls === 1 ? status(503) : ok(PNG))),
    );
    const doc = Document([Page([Image("https://x.example/a.png", { width: 20 })])]);
    await expect(renderToBytes(doc)).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1); // one attempt per render - a dead host is not waited for twice
    await expect(renderToBytes(doc)).resolves.toBeInstanceOf(Uint8Array);
    expect(calls).toBe(2);
  });

  it("does the same for an SVG", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(++calls === 1 ? status(503) : ok(text(SVG)))),
    );
    const doc = Document([Page([Image("https://x.example/a.svg", { width: 20 })])]);
    await expect(renderToBytes(doc)).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(1); // one attempt per render - a dead host is not waited for twice
    await expect(renderToBytes(doc)).resolves.toBeInstanceOf(Uint8Array);
    expect(calls).toBe(2);
  });
});
