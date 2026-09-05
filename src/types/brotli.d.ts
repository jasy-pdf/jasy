/**
 * Local typings for `brotli`, which ships none. Only the decompressor is declared - we never compress,
 * and the module is imported lazily so a document without a WOFF2 never loads it at all.
 */
declare module "brotli/decompress.js" {
  export default function decompress(input: Uint8Array, outputSize?: number): Uint8Array | null;
}
