import { describe, it, expect } from "vitest";
import { getArrayBuffer } from "../../../src/lib/utils/utf8-to-windows1252-encoder";

describe("getArrayBuffer", () => {
  it("should convert a string to an ArrayBuffer", () => {
    const inputString = "Hello";
    const expectedLength = inputString.length;

    const arrayBuffer = getArrayBuffer(inputString);

    // Überprüfen, ob der zurückgegebene Wert ein ArrayBuffer ist
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);

    // Überprüfen, ob die Länge des ArrayBuffers korrekt ist
    expect(arrayBuffer.byteLength).toBe(expectedLength);

    // Überprüfen, ob die Werte korrekt sind
    const u8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < inputString.length; i++) {
      expect(u8Array[i]).toBe(inputString.charCodeAt(i));
    }
  });

  it("should handle an empty string", () => {
    const inputString = "";

    const arrayBuffer = getArrayBuffer(inputString);

    // Überprüfen, ob der zurückgegebene Wert ein ArrayBuffer ist
    expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);

    // Überprüfen, ob die Länge des ArrayBuffers 0 ist
    expect(arrayBuffer.byteLength).toBe(0);
  });

  const bytes = (s: string) => Array.from(new Uint8Array(getArrayBuffer(s)));

  it("keeps Latin-1 chars (incl. German umlauts) as their codepoint byte", () => {
    // ä ö ü ß É sit in 0xA0-0xFF where Windows-1252 == Latin-1.
    expect(bytes("äöüßÉ")).toEqual([0xe4, 0xf6, 0xfc, 0xdf, 0xc9]);
  });

  it("maps the Windows-1252 0x80-0x9F punctuation block correctly", () => {
    // These have Unicode codepoints > 0xFF; a naive low-byte cast would mangle them.
    expect(bytes("€")).toEqual([0x80]); // U+20AC, NOT 0xAC
    expect(bytes("—")).toEqual([0x97]); // em dash U+2014, NOT 0x14
    expect(bytes("–")).toEqual([0x96]); // en dash
    expect(bytes("…")).toEqual([0x85]); // ellipsis
    expect(bytes("“”‘’")).toEqual([0x93, 0x94, 0x91, 0x92]); // smart quotes
    expect(bytes("™•")).toEqual([0x99, 0x95]);
  });

  it("falls back to '?' for characters Windows-1252 cannot represent", () => {
    expect(bytes("☃")).toEqual([0x3f]); // snowman -> "?"
  });
});
