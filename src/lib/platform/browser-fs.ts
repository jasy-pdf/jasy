// Browser stand-in for platform/node-fs.ts (selected by the package.json "browser" field). The browser has
// no file paths, so loading from one throws a clear, actionable error - pass bytes instead.
const hint =
  "needs Node. In the browser pass bytes (Uint8Array / ArrayBuffer) instead - e.g. import the file as a URL and fetch() it, or register a font from its bytes.";

export function readFileBytes(_path: string): Uint8Array {
  throw new Error(`Loading a font from a file path ${hint}`);
}

export function readFileBytesAsync(_path: string): Promise<Uint8Array> {
  throw new Error(`Loading an image from a file path ${hint}`);
}
