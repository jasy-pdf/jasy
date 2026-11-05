// Node implementation of the platform file reads. In a browser bundle this whole module is swapped for
// platform/browser-fs.ts via the package.json "browser" field, so `node:fs` never reaches the browser.
import { readFileSync } from "node:fs";

export function readFileBytes(path: string): Uint8Array {
  return readFileSync(path);
}
