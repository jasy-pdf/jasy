// Browser stand-in for platform/node-fs.ts (selected by the package.json "browser" field). The browser has
// no file paths, so loading from one throws a clear, actionable error - pass bytes instead.
export function readFileBytes(path: string): Uint8Array {
  throw new Error(
    `Loading "${path}" from a file path needs Node. In the browser pass the bytes (a Uint8Array) ` +
      "instead - e.g. import the file as a URL and fetch() it.",
  );
}
