import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string | undefined;

/** A real image file on disk, since `Image(path)` reads the file when it is named. */
export function pngFile(name = "image.png"): string {
  dir ??= mkdtempSync(join(tmpdir(), "jasy-image-"));
  const path = join(dir, name);
  writeFileSync(path, PNG);
  return path;
}
