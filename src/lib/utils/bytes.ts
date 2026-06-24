// Byte helpers for an isomorphic engine (Node + browser). Kept tiny + dependency-free; as the engine
// moves off Node-only APIs, the Node `Buffer` conveniences are replaced by these.

/**
 * A `Uint8Array` → a latin1 (ISO-8859-1) string: each byte 0x00-0xFF maps 1:1 to the same code point.
 * This matches `Buffer.toString("latin1")` exactly. NOTE: do NOT use `TextDecoder("latin1")` here - per
 * the encoding spec that label is really windows-1252, which mangles 0x80-0x9F; we need a true 1:1 pass
 * so arbitrary binary (e.g. a compressed stream) rides through unchanged. The PDF body is assembled as
 * such a binary string and the final encoder passes 0x00-0xFF through.
 */
export function latin1FromBytes(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000; // chunk the apply() to stay under the argument-count limit on big streams
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return out;
}
