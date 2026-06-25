// PNG decode in the browser: the platform's own image decoder, via an OffscreenCanvas, to raw RGBA. No
// jimp, no Buffer - keeps the browser bundle lean and works wherever Canvas does. The package `browser`
// field swaps `node-image.ts` for this module at bundle time.
export async function pngToRgba(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
  const { width, height } = bitmap;
  const ctx = new OffscreenCanvas(width, height).getContext("2d");
  if (!ctx) throw new Error("@jasy/pdf: no 2D canvas context available to decode the PNG.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, height, rgba: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer) };
}
