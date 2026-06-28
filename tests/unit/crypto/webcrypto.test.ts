import { describe, it, expect } from "vitest";
import {
  sha,
  aesCbcEncrypt,
  aesCbcDecrypt,
  aesCbcEncryptNoPad,
  aesCbcDecryptNoPad,
  randomBytes,
} from "../../../src/lib/crypto/webcrypto";

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("webcrypto primitives", () => {
  it("SHA-256 matches the known 'abc' vector", async () => {
    const out = await sha(256, new TextEncoder().encode("abc"));
    expect(toHex(out)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("AES-256-CBC no-pad matches the NIST SP 800-38A vector (proves the no-pad trick)", async () => {
    const key = hex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4");
    const iv = hex("000102030405060708090a0b0c0d0e0f");
    const pt = hex("6bc1bee22e409f96e93d7e117393172a");
    expect(toHex(await aesCbcEncryptNoPad(key, iv, pt))).toBe("f58c4c04d6e5f1ba779eabfb5f7bfbd6");
  });

  it("AES-CBC padded round-trips (the AESV3 string/stream mode)", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const data = new TextEncoder().encode("jasy encrypts this — arbitrary length 🟦🟨");
    const back = await aesCbcDecrypt(key, iv, await aesCbcEncrypt(key, iv, data));
    expect(toHex(back)).toBe(toHex(data));
  });

  it("AES-CBC no-pad round-trips (synthesized-pad decrypt)", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(16);
    const data = randomBytes(48); // 3 blocks, no padding
    const enc = await aesCbcEncryptNoPad(key, iv, data);
    expect(enc.length).toBe(48);
    expect(toHex(await aesCbcDecryptNoPad(key, iv, enc))).toBe(toHex(data));
  });
});
