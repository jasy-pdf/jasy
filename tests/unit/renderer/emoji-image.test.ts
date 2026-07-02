import { describe, it, expect, vi, afterEach } from "vitest";
import { emojiImageUrl } from "../../../src/lib/renderer/emoji-image";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { buildTestTtf } from "../utils/ttf-fixture";

// A valid 1x1 PNG (jimp-encoded), for stubbing an emoji-image fetch without hitting the network.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(() => vi.unstubAllGlobals());

describe("emoji image source (CDN)", () => {
  it("builds a Twemoji-style URL from the code point (lowercase hex)", () => {
    expect(emojiImageUrl(0x1f600, { url: "https://cdn/emoji/", format: "png" })).toBe(
      "https://cdn/emoji/1f600.png",
    );
    expect(emojiImageUrl(0x2764, { url: "https://cdn/", format: "svg" })).toBe(
      "https://cdn/2764.svg",
    );
  });

  it("measures an emoji code point as one em; text is measured normally", () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("Body", buildTestTtf()); // A = 500 units @ em 1000
    om.setEmojiImageSource("https://cdn/", "png");
    expect(om.getCharWidth("😀", 100, undefined, "Body", FontStyle.Normal)).toBe(100); // 1em
    expect(om.getCharWidth("A", 100, undefined, "Body", FontStyle.Normal)).toBeCloseTo(50, 5);
  });

  it("embeds a fetched emoji image as an Image node inline with the text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => PNG_1x1 }),
    );
    const { renderPdf, Document, Page } = await import("../../../src/lib/api/structure");
    const { Text } = await import("../../../src/lib/api");

    const pdf = await renderPdf(
      Document({ emoji: { url: "https://stub.test/", format: "png" } }, [
        Page([Text("A😀B", { font: "Body" })]),
      ]),
      { fonts: { Body: buildTestTtf() }, compress: false },
    );
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("/Subtype /Image"); // the fetched emoji embedded as an XObject
    expect(pdf).toContain("Do"); // ...and drawn
  });

  it("leaves the text intact when the fetch fails (offline / 404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { renderPdf, Document, Page } = await import("../../../src/lib/api/structure");
    const { Text } = await import("../../../src/lib/api");

    const pdf = await renderPdf(
      Document({ emoji: { url: "https://offline.test/", format: "png" } }, [
        Page([Text("A😀B", { font: "Body" })]),
      ]),
      { fonts: { Body: buildTestTtf() }, compress: false },
    );
    expect(pdf.startsWith("%PDF")).toBe(true); // no crash; the emoji is simply absent
    expect(pdf).not.toContain("/Subtype /Image");
  });
});
