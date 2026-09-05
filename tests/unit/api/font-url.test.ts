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
      ["ttcf", /TrueType Collection/],
    ] as const) {
      stubFetch(() => ok(fontLike(tag)));
      await expect(loadFontFromUrl("https://x.example/f")).rejects.toThrow(expected);
    }
  });

  it("accepts both WOFF containers - each is a wrapper around the same sfnt", async () => {
    // Neither is a refusal case: WOFF1 is unpacked when the font is registered, WOFF2 one step
    // earlier in `renderPdf` (its Brotli decoder is loaded lazily, which makes it async).
    for (const tag of ["wOFF", "wOF2"] as const) {
      stubFetch(() => ok(fontLike(tag)));
      await expect(loadFontFromUrl("https://x.example/f")).resolves.toBeInstanceOf(Uint8Array);
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

  it("gives up on a server that never answers", async () => {
    // A hung server must not hang a render. The abort surfaces as a named error saying WHY.
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: { signal?: AbortSignal }) => {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        void init;
        return Promise.reject(err);
      }),
    );
    await expect(loadFontFromUrl("https://x.example/slow.ttf")).rejects.toThrow(
      /did not respond within/,
    );
  });

  it("passes an abort signal, so the timeout is real and not decorative", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: { signal?: AbortSignal }) => {
        seen.push(init?.signal);
        return Promise.resolve(ok(fontLike("ttf")));
      }),
    );
    await loadFontFromUrl("https://x.example/f.ttf");
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("refuses a response that declares itself oversized, before reading it", async () => {
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: { get: (h: string) => (h === "content-length" ? "99999999" : null) },
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    await expect(loadFontFromUrl("https://x.example/huge.ttf")).rejects.toThrow(/the limit is/);
  });

  it("stops an oversized body WHILE it arrives, when nothing was declared", async () => {
    // The header is a hint a server may omit or misstate; the real ceiling is enforced on the stream.
    const chunk = new Uint8Array(1024 * 1024);
    let served = 0;
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              read: async () => ({ done: false, value: (served++, chunk) }),
              cancel: async () => undefined,
            }),
          },
        }) as unknown as Response,
    );
    await expect(loadFontFromUrl("https://x.example/endless.ttf")).rejects.toThrow(
      /larger than the/,
    );
    expect(served).toBeLessThan(100); // it stopped early rather than reading forever
  });

  it("wraps a body that fails mid-read, so the error type still holds", async () => {
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => {
            throw new TypeError("terminated");
          },
        }) as unknown as Response,
    );
    const err = await loadFontFromUrl("https://x.example/f.ttf").catch((e) => e);
    expect(err).toBeInstanceOf(FontUrlError);
    expect(String(err.message)).toMatch(/could not be read: terminated/);
  });

  it("throws a named error type, so a caller can tell it apart", async () => {
    stubFetch(() => ok(fontLike("OTTO")));
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
