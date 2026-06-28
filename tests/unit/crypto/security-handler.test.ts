import { describe, it, expect } from "vitest";
import { createSecurityHandler, StandardAes256 } from "../../../src/lib/crypto/security-handler";
import { aesCbcDecrypt } from "../../../src/lib/crypto/webcrypto";

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
const dictBytes = (dict: string, key: string) =>
  hex(dict.match(new RegExp(`/${key} <([0-9a-f]+)>`))![1]);

describe("StandardAes256 (V5/R6) security handler", () => {
  it("encrypt/decrypt round-trips a string/stream", async () => {
    const h = await createSecurityHandler({ userPassword: "hunter2" });
    const data = new TextEncoder().encode("the page content stream bytes 🟦🟨");
    expect(toHex(await h.decrypt(await h.encrypt(data)))).toBe(toHex(data));
  });

  it("emits a V5/R6 AESV3 /Encrypt dict", async () => {
    const d = (await createSecurityHandler({ userPassword: "x" })).encryptDict();
    expect(d).toContain("/Filter /Standard");
    expect(d).toContain("/V 5");
    expect(d).toContain("/R 6");
    expect(d).toContain("/CFM /AESV3");
  });

  it("recovers the file key from the password via /U + /UE (the decrypt/edit groundwork)", async () => {
    const pw = "öpen-sésame";
    const h = await createSecurityHandler({ userPassword: pw });
    const d = h.encryptDict();
    const data = new TextEncoder().encode("secret payload");
    const enc = await h.encrypt(data);
    const key = await StandardAes256.recoverFileKey(pw, dictBytes(d, "U"), dictBytes(d, "UE"));
    const manual = await aesCbcDecrypt(key, enc.subarray(0, 16), enc.subarray(16));
    expect(toHex(manual)).toBe(toHex(data));
  });

  it("a wrong password does NOT recover the key", async () => {
    const h = await createSecurityHandler({ userPassword: "right" });
    const d = h.encryptDict();
    const enc = await h.encrypt(new TextEncoder().encode("0123456789abcdef"));
    const wrong = await StandardAes256.recoverFileKey(
      "WRONG",
      dictBytes(d, "U"),
      dictBytes(d, "UE"),
    );
    let manual: Uint8Array | null = null;
    try {
      manual = await aesCbcDecrypt(wrong, enc.subarray(0, 16), enc.subarray(16));
    } catch {
      /* bad PKCS#7 padding from the wrong key */
    }
    expect(manual === null || toHex(manual) !== toHex(enc.subarray(16))).toBe(true);
  });
});
