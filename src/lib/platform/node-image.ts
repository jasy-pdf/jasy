// PNG decode on Node: jimp → raw RGBA pixels. jimp is lazy-imported (it pulls Node-ish bits in) so a
// text-only render never loads it. The browser swaps this whole module for `browser-image.ts` (a Canvas
// decode) via the package `browser` field, so neither jimp nor Buffer reach the browser bundle.
export async function pngToRgba(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const { Jimp } = await import("jimp");
  const image = await Jimp.fromBuffer(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
  const { width, height, data } = image.bitmap;
  return { width, height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
