import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderToBytes } from "../../../src/lib/index";
import { StandardAes256 } from "../../../src/lib/crypto/security-handler";
import { aesCbcDecrypt } from "../../../src/lib/crypto/webcrypto";

const lat = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe("PDF encryption (AES-256 R6) end-to-end", () => {
  it("produces an encrypted PDF 2.0 that decrypts with the password", async () => {
    const doc = Document([
      Page({ size: "A4", margin: 40 }, [Text("TopSecretContent", { size: 20 })]),
    ]);
    // compress:false so the decrypted stream is the raw operators (no inflate step needed to assert).
    const bytes = await renderToBytes(doc, {
      compress: false,
      kerning: false,
      encrypt: { userPassword: "letmein" },
    });
    const pdf = lat(bytes);

    expect(pdf.startsWith("%PDF-2.0")).toBe(true);
    expect(pdf).toMatch(/\/Encrypt \d+ 0 R/);
    expect(pdf).toContain("/Filter /Standard");
    expect(pdf).toContain("/V 5");
    expect(pdf).toContain("/AESV3");
    expect(pdf).not.toContain("TopSecretContent"); // the page text is encrypted, not plaintext

    // Recover the file key from the password (exactly what a reader does), then decrypt the streams.
    const u = hex(pdf.match(/\/U <([0-9a-f]+)>/)![1]);
    const ue = hex(pdf.match(/\/UE <([0-9a-f]+)>/)![1]);
    const key = await StandardAes256.recoverFileKey("letmein", u, ue);

    // `pdf` is a single-byte decode, so a string index equals the byte index; slice the RAW bytes here -
    // re-encoding the ciphertext through a string would corrupt the 0x80-0x9F bytes (the web's "latin1" is
    // windows-1252). Match "\nstream\n" so "endstream" is never mistaken for the opening keyword.
    let recovered = false;
    for (let s = pdf.indexOf("\nstream\n"); s >= 0; s = pdf.indexOf("\nstream\n", s + 1)) {
      const e = pdf.indexOf("\nendstream", s + 8);
      if (e < 0) continue;
      const blob = bytes.subarray(s + 8, e);
      if (blob.length < 32) continue;
      try {
        const dec = lat(await aesCbcDecrypt(key, blob.subarray(0, 16), blob.subarray(16)));
        if (dec.includes("TopSecretContent")) recovered = true;
      } catch {
        /* not a stream that decrypts cleanly with this key */
      }
    }
    expect(recovered).toBe(true);
  });

  it("refuses to encrypt a PDF/A document", async () => {
    const doc = Document([Page({ size: "A4" }, [Text("x")])]);
    await expect(
      renderToBytes(doc, {
        outputIntent: new Uint8Array(8), // marks it PDF/A-ish (an OutputIntent is set)
        encrypt: { userPassword: "p" },
      }),
    ).rejects.toThrow(/PDF\/A/);
  });
});
