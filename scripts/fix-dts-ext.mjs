// Post-build: rewrite relative import/export specifiers ending in `.ts` -> `.js` in the emitted .d.ts files.
// tsc's `rewriteRelativeImportExtensions` rewrites the .js output but leaves declaration files on `.ts`,
// so published types would point at `./x.ts` (not shipped). This makes the .d.ts reference `./x.js`.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
let count = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".d.ts")) {
      const orig = readFileSync(p, "utf8");
      const next = orig.replace(
        /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*)\.ts(['"])/g,
        "$1$2$3.js$4",
      );
      if (next !== orig) { writeFileSync(p, next); count++; }
    }
  }
})(DIST);
console.log(`fix-dts-ext: ${count} .d.ts files rewritten (.ts -> .js)`);
