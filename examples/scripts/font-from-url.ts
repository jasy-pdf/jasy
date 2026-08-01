/**
 * Register a font from a URL and render with it - no file, no build step, no font in your repository.
 *
 * `addFontFromUrl` fetches AT REGISTRATION, exactly as `addFont` reads a path there and then. That is
 * why it is async and why a dead link fails HERE, on the line that asked for the font, rather than
 * somewhere inside a later render.
 *
 * What arrives in the PDF is a SUBSET: only the glyphs the document actually uses are embedded. The
 * three Lato faces below are about 2 MB of source, and the finished file is around 65 KB.
 *
 * Run (the same way examples/render.sh does it - `@jasy/pdf` resolves to this repo):
 *   mkdir -p node_modules/@jasy && ln -sfn "$PWD" node_modules/@jasy/pdf
 *   pnpm build && node examples/scripts/font-from-url.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  Box,
  Column,
  DefaultTextStyle,
  Document,
  Page,
  Row,
  Text,
  renderToBytes,
  FontUrlError,
} from "@jasy/pdf";

const CDN = "https://raw.githubusercontent.com/google/fonts/main/ofl/lato";

const doc = Document({ size: 11 }, [
  Page({ size: "A4", margin: 52, gap: 10 }, [
    Text("Fonts, straight from a URL", { size: 22, bold: true, font: "Lato", color: "#0a2348" }),
    Text(
      "Nothing was downloaded by hand and nothing lives in this project. The three faces below were " +
        "fetched over the network and embedded, subsetted, into this file - which is why the umlauts " +
        "and the punctuation come out right.",
      { font: "Lato", color: "#475569" },
    ),

    Box({ bg: "#eef2fb", radius: 6, padding: 14, borderWidth: 0 }, [
      DefaultTextStyle({ font: "Lato", size: 13 }, [
        Column({ gap: 5 }, [
          Text("Regular - Größenwahn, Straße, Fußgängerübergang"),
          Text("Bold - Größenwahn, Straße, Fußgängerübergang", { bold: true }),
          Text("Italic - Größenwahn, Straße, Fußgängerübergang", { italic: true }),
        ]),
      ]),
    ]),

    Text("The same line in the built-in Helvetica, for comparison:", { size: 9, color: "#64748b" }),
    Text("Regular - Größenwahn, Straße, Fußgängerübergang", { size: 13 }),

    Row({ gap: 10 }, [
      Box({ bg: "#e8f4ea", radius: 6, padding: 12, borderWidth: 0, width: 240 }, [
        Text("A style that was never fetched falls back to normal - it is not faked:", {
          size: 8.5,
          color: "#2f6b45",
        }),
        Text("boldItalic (not loaded)", { font: "Lato", bold: true, italic: true, size: 12 }),
      ]),
      Box({ bg: "#fdf1e0", radius: 6, padding: 12, borderWidth: 0, width: 240 }, [
        Text("Only the glyphs actually used are embedded:", { size: 8.5, color: "#8a5a12" }),
        Text("subsetted, roughly 97% smaller", { font: "Lato", size: 12 }),
      ]),
    ]),
  ]),
]);

// A whole styled family in one call; the faces are fetched in parallel. Leave a style out and
// `Text({ bold })` falls back to `normal` rather than faking a weight.
try {
  await doc.addFontFromUrl("Lato", {
    normal: `${CDN}/Lato-Regular.ttf`,
    bold: `${CDN}/Lato-Bold.ttf`,
    italic: `${CDN}/Lato-Italic.ttf`,
  });
} catch (e) {
  // Named, and it says what the file actually was - a 404 page, a WOFF2, an OpenType/CFF font.
  if (e instanceof FontUrlError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

console.log("registered:", doc.getFonts().join(", "));

mkdirSync("examples/out", { recursive: true });
const bytes = await renderToBytes(doc);
writeFileSync("examples/out/font-from-url.pdf", bytes);
console.log(`examples/out/font-from-url.pdf - ${bytes.length} bytes`);
