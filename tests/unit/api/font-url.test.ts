import { describe, it, expect, afterEach, vi } from "vitest";
import { Document, Page, Text } from "../../../src/lib/api/index.ts";
import { FontUrlError, loadFontFromUrl } from "../../../src/lib/api/font-url.ts";

// `addFontFromUrl` fetches AT REGISTRATION, exactly as `addFont` reads a path there and then, so a
// broken link fails where you asked for the font rather than inside a later render. `fetch` is stubbed
// here: what matters is the contract around it, and no test may reach the network.
//
// No real .ttf is used - the only ones in this repo live in the gitignored `claude-data/`, so a test
// depending on them would fail in a fresh clone. The signature check reads the first four bytes, which
// is all these fixtures need to provide.

/** A buffer that starts like the given sfnt flavour; the rest is padding, never parsed here. */
const fontLike = (tag: "ttf" | "OTTO" | "wOFF" | "wOF2" | "ttcf" | "html"): Uint8Array => {
  const head =
    tag === "ttf"
      ? [0x00, 0x01, 0x00, 0x00]
      : tag === "html"
        ? [0x3c, 0x21, 0x44, 0x4f] // "<!DO"
        : [...tag].map((c) => c.charCodeAt(0));
  return new Uint8Array([...head, ...Array.from({ length: 64 }, () => 0)]);
};

const stubFetch = (fn: (url: string) => Promise<Response> | Response) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((u: string) => Promise.resolve(fn(u))),
  );
};
const ok = (bytes: Uint8Array) =>
  ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());

describe("a font that loads", () => {
  it("hands back the bytes it fetched", async () => {
    stubFetch(() => ok(fontLike("ttf")));
    const bytes = (await loadFontFromUrl("https://x.example/Inter.ttf")) as Uint8Array;
    expect(bytes.subarray(0, 4)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it("fetches a whole family, one request per style", async () => {
    const seen: string[] = [];
    stubFetch((u) => {
      seen.push(u);
      return ok(fontLike("ttf"));
    });
    const family = (await loadFontFromUrl({
      normal: "https://x.example/n.ttf",
      bold: "https://x.example/b.ttf",
    })) as { normal: Uint8Array; bold?: Uint8Array; italic?: Uint8Array };
    expect(seen).toEqual(["https://x.example/n.ttf", "https://x.example/b.ttf"]);
    expect(family.normal.length).toBeGreaterThan(0);
    expect(family.bold).toBeDefined();
    expect(family.italic).toBeUndefined(); // a style not given is not invented
  });
});

describe("it refuses by name, never by failing deep inside the parser", () => {
  it("says which URL and which status", async () => {
    stubFetch(() => ({ ok: false, status: 404 }) as Response);
    await expect(loadFontFromUrl("https://x.example/nope.ttf")).rejects.toThrow(
      /nope\.ttf could not be fetched: HTTP 404/,
    );
  });

  it("reports a network failure with its cause", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))),
    );
    await expect(loadFontFromUrl("https://x.example/f.ttf")).rejects.toThrow(/ENOTFOUND/);
  });

  it("names the format when the file is a font we cannot parse", async () => {
    // The point of checking the signature at all: TTFParser never looks at it and would fail with
    // `missing required table "head"`, which tells the user nothing about what they actually linked.
    for (const [tag, expected] of [
      ["OTTO", /OpenType\/CFF/],
      ["wOFF", /WOFF font/],
      ["wOF2", /WOFF2/],
      ["ttcf", /TrueType Collection/],
    ] as const) {
      stubFetch(() => ok(fontLike(tag)));
      await expect(loadFontFromUrl("https://x.example/f")).rejects.toThrow(expected);
    }
  });

  it("spots the classic mistake - a URL that returns an error PAGE", async () => {
    stubFetch(() => ok(fontLike("html")));
    await expect(loadFontFromUrl("https://x.example/f.ttf")).rejects.toThrow(/not a font at all/);
  });

  it("refuses an empty response", async () => {
    stubFetch(() => ok(new Uint8Array()));
    await expect(loadFontFromUrl("https://x.example/f.ttf")).rejects.toThrow(/is empty/);
  });

  it("throws a named error type, so a caller can tell it apart", async () => {
    stubFetch(() => ok(fontLike("wOF2")));
    await expect(loadFontFromUrl("https://x.example/f.ttf")).rejects.toBeInstanceOf(FontUrlError);
  });
});

describe("on the document", () => {
  it("registers under the name, queryable like any other font", async () => {
    stubFetch(() => ok(fontLike("ttf")));
    const doc = Document([Page({ margin: 40 }, [Text("hi", { font: "Inter" })])]);
    expect(doc.hasFont("Inter")).toBe(false);

    const same = await doc.addFontFromUrl("Inter", "https://x.example/Inter.ttf");
    expect(same).toBe(doc); // chainable, like addFont
    expect(doc.hasFont("Inter")).toBe(true);
    expect(doc.getFonts()).toContain("Inter");
  });

  it("does not register anything when the fetch fails", async () => {
    // The registry must not end up holding a half-loaded family.
    stubFetch(() => ({ ok: false, status: 500 }) as Response);
    const doc = Document([Page({ margin: 40 }, [Text("hi")])]);
    await expect(doc.addFontFromUrl("Inter", "https://x.example/Inter.ttf")).rejects.toThrow();
    expect(doc.hasFont("Inter")).toBe(false);
  });
});
