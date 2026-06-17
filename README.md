# JasyPDF

> **Ja**vaScript Ea**sy** **PDF** — declarative, component-based PDF generation in pure TypeScript.

JasyPDF lets you describe a document as a tree of components — `Page`, `Column`, `Row`, `Box`,
`Text`, `Image` — the way you'd build a UI in Flutter, and writes the raw PDF byte stream itself.
**No headless browser, no Java, no `pdf-lib` underneath.** The low-level writer is hand-rolled, and
text is laid out with the real Adobe **AFM font metrics** of the standard-14 fonts, so word-wrapping
and kerning are _computed_, not guessed.

> ⚠️ **Status: 0.0.1, pre-release.** The engine and the API below work and are tested, but the
> library is young and not yet published. Expect rough edges. Runs on **Node** today (browser support
> is on the roadmap).

## What works today

- **Declarative factory API** — `Document` / `Page` / `Column` / `Row` / `Box` / `Padding` / `Text` /
  `Paragraph` / `span` / `Image` / `Divider` / `Spacer` / `Expanded`.
- **Real text layout** — AFM metrics for the **standard-14 fonts** (Helvetica, Times, Courier, Symbol,
  ZapfDingbats), with bold/italic, mixed inline styling (`span`), alignment and word-wrapping.
- **Flexbox-style layout** — `gap`, `main` (start/center/end/between/around) and `cross`
  (start/center/end/stretch) on Column and Row; `Spacer`/`Expanded` for flexible space.
- **Boxes** — fill, border, corner `radius`, real transparency (RGBA/alpha), and `padding`.
- **Images** — JPEG/PNG via `fit` (none/contain/cover/fill) and rounded corners.
- **Colors** — `"steelblue"` (full CSS set), `"#1450aa"`, `"#1450aacc"` (hex+alpha),
  `0xff1450aa` (ARGB), `rgb()`/`rgba()`.
- **Real pagination** — content that overflows a page flows onto the next: text breaks at line
  boxes, bordered boxes split (each fragment keeps its border), and `header`/`footer` repeat on
  every physical page.
- **Tables** — fixed / `Nfr` / `auto` column widths, a header that repeats on every page, crisp
  `cellBorder` grid lines, equal-height cells, paginating at row boundaries.
- **Custom fonts** — embed any TrueType (`.ttf`) font via `renderPdf(doc, { fonts })` (Type0/Identity-H,
  full font). Register a **family** (`{ normal, bold, italic, boldItalic }`) and `Text({ bold, italic })`
  picks the right file automatically, falling back to `normal` when a style isn't supplied. Unlocks full
  Unicode (Cyrillic, Greek, …) beyond the standard-14, and text stays copy-/searchable. _Subsetting
  (smaller files) and OTF/WOFF2 are still to come._

## Quick start

```ts
import { Document, Page, Column, Box, Text, Divider, renderToBytes } from "@jasy/pdf";

const doc = Document([
  Page({ size: "A4", margin: 56, gap: 12 }, [
    Text("JasyPDF", { size: 32, bold: true, color: "#1450aa" }),
    Text("Declarative PDFs in pure TypeScript", { size: 12, color: "gray" }),
    Divider({ color: "steelblue" }),
    Box({ border: "steelblue", bg: "#1450aa22", padding: 12, radius: 6 }, [
      Text("A note box that shrink-wraps its content and paginates cleanly."),
    ]),
  ]),
]);

const bytes: Uint8Array = await renderToBytes(doc); // write to a file or stream it
```

`renderPdf(doc)` returns the PDF as a string; `renderToBytes(doc)` returns a `Uint8Array`.
The engine classes (`PageElement`, `ContainerElement`, …) stay exported for power users — the
factories are sugar over them, never a wall.

## Roadmap

- **Font subsetting** — embed only the glyphs used, for much smaller files (today the full `.ttf` is
  embedded); plus OTF/CFF and WOFF2 font formats.
- **ZUGFeRD / XRechnung** — EN-16931 invoice XML + PDF/A-3 output, in pure TS.
- **Framework bindings** — author documents as Vue / React components on top of the same vocabulary.
- **Browser support** — bundle the AFM metrics so the engine runs without Node's filesystem.

## Develop

Package manager is **pnpm**.

```bash
pnpm install
pnpm exec vitest run     # unit tests
pnpm run build           # tsc → dist/
pnpm run manual-test     # render the capability showcase → claude-data/out/showcase.pdf
```

## License

MIT © Florian Heuberger
