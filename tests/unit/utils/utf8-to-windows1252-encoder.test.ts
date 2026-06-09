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
});
