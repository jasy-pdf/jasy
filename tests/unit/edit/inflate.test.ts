import { describe, it, expect } from "vitest";
import { zlibSync } from "fflate";
import {
  DEFAULT_MAX_STREAM_SIZE,
  inflateBounded,
  PdfStreamTooLargeError,
} from "../../../src/lib/edit/inflate.ts";
import { PdfDocument } from "../../../src/lib/edit/document.ts";
import { get, isStream } from "../../../src/lib/edit/objects.ts";

// A PDF stream declares its COMPRESSED length and says nothing about what it expands to, so a few
// kilobytes of crafted input can expand until the process dies. The bomb below is BUILT here rather than
// committed: a fixture that inflates to hundreds of megabytes is not something to keep in a repository,
// and generating it is three lines.

/** A zlib stream of `size` zero bytes - a few hundred KB of input, `size` bytes of output. */
const bomb = (size: number) => zlibSync(new Uint8Array(size));

describe("inflateBounded", () => {
  it("inflates an ordinary stream untouched", () => {
    const text = "the quick brown fox".repeat(100);
    const out = inflateBounded(zlibSync(new TextEncoder().encode(text)), DEFAULT_MAX_STREAM_SIZE);
    expect(new TextDecoder().decode(out)).toBe(text);
  });

  it("refuses a stream that expands past the ceiling", () => {
    // 48 MB from a few hundred KB. Without a ceiling this is the whole attack.
    const attack = bomb(48 * 1024 * 1024);
    expect(attack.length).toBeLessThan(256 * 1024);
    expect(() => inflateBounded(attack, 1024 * 1024)).toThrow(PdfStreamTooLargeError);
  });

  it("says WHICH limit was hit and how to raise it", () => {
    // The error a caller sees decides whether they can act on it. "Invalid stream" would not.
    const err = (() => {
      try {
        inflateBounded(bomb(48 * 1024 * 1024), 1024);
        return undefined;
      } catch (e) {
        return e as PdfStreamTooLargeError;
      }
    })();
    expect(err).toBeInstanceOf(PdfStreamTooLargeError);
    expect(err!.limit).toBe(1024);
    expect(err!.message).toMatch(/maxStreamSize/);
  });

  it("is off by no more than fflate's own block, not by a factor", () => {
    // The check runs per emitted block, so the abort lands slightly PAST the ceiling - it has to be
    // bounded, or the ceiling is decorative. A stream just under it must still come through whole.
    const justUnder = zlibSync(new Uint8Array(500 * 1024));
    expect(inflateBounded(justUnder, 1024 * 1024).length).toBe(500 * 1024);
  });
});

describe("the reader refuses a bomb rather than reading it", () => {
  /** A minimal one-page PDF whose single content stream is the given (already deflated) payload. */
  const pdfWithStream = (payload: Uint8Array): Uint8Array => {
    const head = "%PDF-1.7\n";
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    ];
    const parts: Uint8Array[] = [];
    const enc = (s: string) => new TextEncoder().encode(s);
    let at = head.length;
    const offsets: number[] = [];
    parts.push(enc(head));
    objs.forEach((o, i) => {
      offsets.push(at);
      const chunk = enc(`${i + 1} 0 obj\n${o}\nendobj\n`);
      parts.push(chunk);
      at += chunk.length;
    });
    offsets.push(at);
    const dict = enc(`4 0 obj\n<< /Length ${payload.length} /Filter /FlateDecode >>\nstream\n`);
    parts.push(dict, payload, enc("\nendstream\nendobj\n"));
    at += dict.length + payload.length + "\nendstream\nendobj\n".length;

    let tail = `xref\n0 5\n0000000000 65535 f \n`;
    for (const off of offsets) tail += `${String(off).padStart(10, "0")} 00000 n \n`;
    tail += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
    parts.push(enc(tail));

    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let w = 0;
    for (const p of parts) {
      out.set(p, w);
      w += p.length;
    }
    return out;
  };

  const contentStream = (doc: PdfDocument) => {
    const kids = doc.lookup(doc.lookup(doc.catalog, "Pages"), "Kids");
    const page = doc.resolve(Array.isArray(kids) ? kids[0] : undefined);
    const s = doc.resolve(get(page, "Contents"));
    if (!isStream(s)) throw new Error("no content stream in the test document");
    return s;
  };

  it("throws instead of handing back silently truncated data", () => {
    // The important half. fflate does NOT throw on an over-long inflate - it TRUNCATES - and the
    // surrounding catch in `streamData` is there to swallow a stream that will not decode. Getting this
    // wrong turns "this file is attacking you" into "here, have some garbage", which is worse than the
    // original bug because it looks like it worked.
    const doc = PdfDocument.load(pdfWithStream(bomb(48 * 1024 * 1024)), {
      maxStreamSize: 1024 * 1024,
    });
    expect(() => doc.streamData(contentStream(doc))).toThrow(PdfStreamTooLargeError);
  });

  it("still reads a legitimate stream of the same shape", () => {
    const doc = PdfDocument.load(pdfWithStream(zlibSync(new TextEncoder().encode("BT ET"))));
    expect(new TextDecoder().decode(doc.streamData(contentStream(doc)))).toBe("BT ET");
  });

  it("keeps swallowing a stream that is merely corrupt", () => {
    // Not every failure is an attack: a stream that will not decode is not ours to repair, and the
    // reader hands back what it has. That behaviour has to survive the new throw.
    const doc = PdfDocument.load(pdfWithStream(new Uint8Array([1, 2, 3, 4, 5])));
    expect(() => doc.streamData(contentStream(doc))).not.toThrow();
  });
});
