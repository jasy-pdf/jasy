// Node implementation of the platform file reads. In a browser bundle this whole module is swapped for
// platform/browser-fs.ts via the package.json "browser" field, so `node:fs` never reaches the browser.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export function readFileBytes(path: string): Uint8Array {
  return readFileSync(path);
}

export function readFileBytesAsync(path: string): Promise<Uint8Array> {
  return readFile(path);
}
