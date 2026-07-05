# JasyPDF — CLAUDE.md

> **Ja**vaScript Ea**sy** **PDF** — a declarative, component-based PDF generation library in pure
> TypeScript, inspired by Flutter's widget tree. You describe a document as a tree of element
> objects (`PageElement`, `ContainerElement`, `TextElement`, `PaddingElement`, …) and the library
> lays it out and writes the raw PDF byte stream itself — no headless browser, no Java, no pdf-lib
> underneath. The low-level PDF writer is hand-rolled.

This file is the orientation map for working in this repo. Read it first.

## The dream (why this project exists)

Two goals, and they are **decoupled** — don't conflate them:

1. **A great declarative layout engine for documents** (Flutter-style components → PDF), with
   _first-class pagination_ — content that flows correctly across multiple pages: text breaks at
   lines, images move as a whole, columns balance, borders/padding survive a page break. This is the
   part Flo got ~85% working in a previous attempt and hit a wall on the last 15%.
2. **Open-source ZUGFeRD / XRechnung / Factur-X** support in pure TS/JS — the real strategic prize.
   The TS/Node ecosystem has no polished, dependency-light library that renders the human-readable
   invoice PDF **and** emits the conformant EN-16931 CII/UBL XML **and** validates it. Mustangproject
   (Java), horstoeko/zugferd (PHP), factur-x (Python) own the other ecosystems; Node is thin. This is
   the niche. Crucially, ZUGFeRD invoices are the _tamest_ document class (a table + totals + footer),
   so they do **not** require the hard 15% of pagination — and the hand-rolled byte-level writer is an
   _advantage_ for hitting PDF/A-3 conformance precisely.

**Competitive framing:** we are _not_ competing with pdf.js (a reader/parser) or pdf-lib/PDFKit
(low-level drawers with no layout engine). The real comparison is @react-pdf/renderer + Yoga. Beating
them on pagination correctness + DX is realistic. Beating Prince/WeasyPrint/LaTeX on typographic
quality (microtypography, hyphenation, bidi, floats) is **not** a goal and not needed for the target
use cases (invoices, reports, quotes, datasheets).

## Architecture

Two-phase pipeline: **layout** (synchronous, mutating, top-down) then **render** (async, produces
PDF content-stream strings). Entry point is `PDFDocument.render()`.

```
PDFDocument (abstract, user subclasses it, implements build())
  └─ build() → PDFDocumentElement
       ↓  PDFRenderer.render(documentElement)        src/lib/renderer/pdf-renderer.ts
       ├─ RendererRegistry.register(...) all element→renderer pairs
       ├─ document.calculateLayout()                 ← PASS 1: layout (recursive, mutates elements)
       └─ PDFDocumentRenderer.render(...)            ← PASS 2: build display list, then serialize
            └─ PageRenderer → element renderers → IRNode[] → PdfBackend.serialize → content stream
       → assembles objects, xref table, trailer → returns the PDF as a string
```

> "Pass 1 / Pass 2" are the two render passes inside one `render()` call. Don't confuse them with the
> **roadmap Phases** in `todo.md` (Phase 1 = IR seam, Phase 2 = kill singleton, …). Different things.

### Pass 1 — `calculateLayout(constraints, offset, ctx)`

- Defined on every element (`PDFElement.calculateLayout`). Signature: `calculateLayout(constraints:
BoxConstraints, offset: Offset, ctx: LayoutContext): Size` — constraints (min/max w/h) flow **down**,
  the parent assigns each child its absolute `offset`, the element returns the `Size` it took **up**.
  The clean Flutter `RenderObject` contract (since Phase 4; `layout/box-constraints.ts`).
- `FlexLayoutHelper` (`utils/flex-layout.ts`) is axis-generic: it measures **and** places both `Column`
  (`VERTICAL_AXIS`) and `Row` (`HORIZONTAL_AXIS`), distributing leftover main-axis space to
  `ExpandedElement`s by `flex` and offsetting children per `main`/`cross` alignment.
- **Pagination is real** (Phase 5). A `fragment(maxHeight, width, ctx) → { fitted, remainder }` protocol
  (`layout/fragmentation.ts`, shared `packChildren`) splits content across pages: text at line boxes,
  padding/border cloned per fragment, flex containers re-packed. The page driver (`PDFDocumentRenderer`)
  loops the remainder into fresh physical pages; `header`/`footer` repeat on each.
- **The Y-flip lives at the IR→backend seam, NOT in elements** (Phase 3). Elements lay out in a top-left
  origin and are coordinate-blind; `PdfBackend.flipY(nodes, pageHeight)` flips once per page. `grep
normalizeCoordinates src/` is empty.

### Pass 2 — render: display list → backend (the IR seam, since roadmap Phase 1)

The render pass is split at a hard seam — **the display list (IR)** — so the PDF byte writer never
sees a component:

- **Producers** (`src/lib/renderer/*`, one class per element, dispatched via `RendererRegistry` keyed
  on the element's constructor): each `render(element, objectManager)` returns an **`IRNode[]`**, not
  a string. Leaves (`TextRenderer`→`TextRun[]`, `LineRenderer`, `ImageRenderer`, `RectangleRenderer`)
  emit primitives; structural renderers (`Container`/`Expanded`/`Padding`, and `Rectangle` for its
  children) **concatenate** their children's lists. Producers still know about components and still do
  layout-ish work; text wrapping is the shared `text/line-breaker.ts` (one canonical wrapper feeding
  measure, draw and fragmentation — Phase 3).
- **The seam** — `src/lib/ir/display-list.ts`: `IRNode = TextRun | Rect | Line | Image`. Dumb
  primitives: absolute geometry + semantic style (a `Color`, a font family/style), **no** PDF
  operators, font indices, or object numbers.
- **The backend** — `src/lib/renderer/pdf-backend.ts` (`PdfBackend`): consumes **only** `IRNode`s and
  emits content-stream operators. It owns PDF resource creation (`registerFont`/`registerImage`) and
  color formatting. `PdfBackend.serialize(nodes, om)` is the page-level entry point; it is the only
  place that turns IR into bytes. **It never reads `getProps()`.**
- `PageRenderer` collects the whole page's `IRNode[]`, calls `PdfBackend.serialize` **once**, wraps the
  result in a `/Contents` stream object + `/Page` object with `MediaBox`, font and image `/Resources`.
  Serialize runs _before_ the resource section because that is what registers the fonts/images.
- Coordinates in the IR are top-left (engine origin); `PdfBackend.flipY(nodes, pageHeight)` flips them
  to PDF's bottom-left once per page at this seam — no element does a Y-flip (Phase 3 done).

### The PDF writer — `PDFObjectManager` (`utils/pdf-object-manager.ts`)

The hand-rolled core. Holds the indirect-object array, tracks byte offsets for the xref table, manages
fonts and images, and owns config. Also the **font-metrics engine**: parses the 14 standard-font AFM
files (`assets/*.afm` via `AFMParser`) to compute `getStringWidth` / `getCharWidth` / kerning — this
is what makes text wrapping possible without a browser. Standard text is encoded as Windows-1252 /
WinAnsiEncoding (`utils/utf8-to-windows1252-encoder.ts`). **Custom TrueType fonts** plug in beside this:
`TTFParser` (`utils/ttf-parser.ts`) reads the same metrics straight from the `.ttf` (hmtx/cmap), and
`registerCustomFont` embeds the font as a Type0/Identity-H graph (`/FontFile2`) — the metric + emission
paths branch on the font name (`isCustomFont`), leaving the AFM/WinAnsi path byte-identical. `TTFParser`
also parses `glyf`/`loca` outlines + COLR/CPAL color tables for color emoji (see the ✅ Color emoji entry).

### State threading — explicit, no singleton (since roadmap Phase 2)

There is **no global object manager** (the old `@InjectObjectManager` / `reflect-metadata` decorator is
gone). Each `PDFDocument` instance owns one `PDFObjectManager`, created in its constructor and passed
explicitly into `PDFRenderer.render(document, objectManager)`. Two documents render independently — no
shared state.

- **Layout pass (Pass 1)** threads a `LayoutContext { metrics, pageConfig }` through `calculateLayout`
  (defined in `elements/pdf-element.ts`). `metrics` is a `FontMetrics` interface (`utils/font-metrics.ts`,
  implemented by `PDFObjectManager`) — deliberately _not_ the byte writer, so layout/measuring can never
  touch PDF object creation. `pageConfig` is the geometry of the page currently being laid out:
  `PageElement.calculateLayout` merges the document defaults with its own config and hands its subtree a
  context bound to **its** geometry. This is why each page flips Y against its own height.
- **Render pass (Pass 2)** passes the `objectManager` explicitly to each renderer (for font/image
  resource registration via the backend).
- This shape is what the fragmentation pass (Phase 5, now built) needs: it threads exactly metrics +
  per-page geometry, nothing more. A `relative` positioning frame would thread one more geometry here.

## Element & renderer inventory

| Element                 | File                                         | Renderer              | Notes                                                                   |
| ----------------------- | -------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| `PDFDocumentElement`    | `elements/pdf-document-element.ts`           | `PDFDocumentRenderer` | root, holds pages                                                       |
| `PageElement`           | `elements/page-element.ts`                   | `PageRenderer`        | per-page `config` (size/orientation/margin)                             |
| `ContainerElement`      | `elements/container-element.ts`              | `ContainerRenderer`   | sized box, flex column of children                                      |
| `TextElement`           | `elements/text-element.ts`                   | `TextRenderer`        | string or `TextSegment[]` (mixed font/size/color), alignment, word-wrap |
| `PaddingElement`        | `elements/layout/padding-element.ts`         | `PaddingRenderer`     | margin `[top,right,bottom,left]`, sizes to child                        |
| `ExpandedElement`       | `elements/layout/expanded-element.ts`        | `ExpandedRenderer`    | flex child, fills remaining height                                      |
| `SizedContainerElement` | `elements/layout/sized-container-element.ts` | —                     |                                                                         |
| `ImageElement`          | `elements/image-element.ts`                  | `ImageRenderer`       | via `jimp`; `BoxFit`, grayscale; `CustomLocalImage`                     |
| `LineElement`           | `elements/line-element.ts`                   | `LineRenderer`        | stroke                                                                  |
| `RectangleElement`      | `elements/rectangle-element.ts`              | `RectangleRenderer`   | fill + stroke                                                           |
| `Color`                 | `common/color.ts`                            | —                     | RGB → PDF color string                                                  |

Every renderer's `render()` returns `Promise<IRNode[]>` (since roadmap Phase 1). Adding an element =
new element + renderer that returns IR + (if it draws something new) a primitive in `ir/display-list.ts`
plus a `case` in `PdfBackend.serializeNode`. Register the renderer in `PDFRenderer.render()`.

## The intuitive API layer (`src/lib/api/`, built 2026-06-16)

A curated **factory layer ON TOP of the engine** — what users write — exported from the root
`index.ts` (one import surface). Factories (`Document`/`Page`/`Column`/`Row`/`Box`/`Padding`/`Text`/
`Paragraph`/`span`/`Image`/`Divider`/`Spacer`/`Expanded`) are sugar that compile down to engine
elements; the engine classes stay untouched and exported for power users. Input normalizers:
`toColor` (`color.ts`: named CSS / hex / ARGB / `rgb()`), `toEdges` (`insets.ts`). Render entry:
`renderPdf(doc) → string` / `renderToBytes(doc) → Uint8Array` (`structure.ts`). The **firewall** for
future Vue/React bindings is `descriptor.ts`: `Descriptor {type,props,children}` + `build()` resolves
each node through the SAME factories (`registerElement` adds custom types). Design is locked in
`docs/api-design.md`; the 6-page `tests/manual/showcase.ts` is the canonical example + DX check.
⚠️ An element module must NOT import the `"../renderer"` barrel (it duplicates element classes under
ESM and breaks the constructor-keyed `RendererRegistry` → blank PDFs); import the specific renderer.

## Claude's private harness (`claude-data/`, gitignored)

My own scratch area — not part of the package. `bash claude-data/render.sh` compiles the lib + a
sample document (`claude-data/scripts/sample-doc.ts` + `run.ts`), copies the AFM assets, and writes
`claude-data/out/sample.pdf`. To _see_ a render: `pdftoppm -png -r 150 sample.pdf page` (poppler is
installed; `gs`/`pdftocairo` also present) then view the PNGs. Use this loop to verify any layout
change visually, not just via tests.

**Visual regression gallery** (`bash claude-data/gallery.sh`) — the cumulative one. Renders EVERY case
in `claude-data/gallery/cases/` (text-wrap, border-radius, opacity, row/alignment, nested, pagination,
header/footer …) to `claude-data/out/gallery/<name>.{pdf,png}` in one shot, so after any change you
eyeball the whole catalogue and catch regressions in _old_ features, not just the one you touched. Add
a feature ⇒ add a `cases/NN-name.ts` (a `makeDoc(() => page([...]))` from `kit.ts`) + register it in
`gallery/registry.ts`. **Never overwrite an existing case** — the point is that old cases keep
rendering. This is the standing visual check; prefer it over one-off `scripts/run-*.ts` demos.

## Build / test / run

**Package manager is pnpm** (migrated from npm 2026-06-09; `pnpm-lock.yaml` committed,
`package-lock.json` removed). Use `pnpm` / `pnpm exec`, not `npm`/`npx`.

- `pnpm test` — Vitest (watch). `pnpm exec vitest run` for a one-shot CI-style run.
  `pnpm run test:coverage` for coverage. Unit tests live in **`tests/unit/`**, mirroring the `src/lib/`
  structure (`tests/unit/{common,elements,renderer,utils}/…`). `src/` is pure production code — the
  build (`tsconfig.json` includes only `src/**`) therefore keeps `dist/` test-free. **~415 tests, green**
  in the core (plus the `@jasy/zugferd` suite).
- `pnpm run build` — `tsc` → `dist/`.
- `pnpm run lint` (oxlint) + `pnpm run fmt:check` (oxfmt `--check`); `pnpm run fmt` formats. **Run `pnpm run fmt`
  before committing** — CI fails on unformatted files.
- **CI** (`.github/workflows/`, since 2026-06-27): `pr.yml` = the PR gate (PR-title lint → lint+fmt → build →
  only-changed tests via `vitest --changed`, staged + fail-fast, Node 24); `ci.yml` = full suite on `main`
  (Node 22 + 24); `release.yml` = publish + GitHub Release on a `<pkg>-v*` tag.
- `pnpm run manual-test` — compiles via `tsconfig.test.json`, copies AFM assets, runs
  `tests/manual/index.ts` (renders the `showcase.ts` capability demo). `tests/manual/` is **gitignored**
  — a DX/showcase harness that reads sample images from the private `claude-data/` scratch, so it isn't
  self-contained for a fresh clone. To become a polished public example later (committed clean assets).
  For a quick visual check, prefer `claude-data/render.sh` (above).
- Note: the core package is now named `@jasy/pdf` (npm scope `@jasy`, GitHub org `jasy-pdf`). It is the
  pnpm-workspace root; the ZUGFeRD work lives in `packages/zugferd` (`@jasy/zugferd`).

## Conventions

- **Comments and identifiers in English** (a few older German comments/strings linger, e.g. in
  `pdf-object-manager.ts`). Match the English style when adding code.
- Element constructors take a **single options object** (`new TextElement({ fontSize, content, … })`),
  Flutter-style. Sensible defaults in the destructure (e.g. `fontFamily = "Helvetica"`).
- Elements expose state via `getProps()`; renderers consume `getProps()`, never reach into privates.
- Renderers return `IRNode[]`, never PDF strings. PDF operators live **only** in `PdfBackend`.
- New element = new file in `elements/`, export from `elements/index.ts`, write a renderer in
  `renderer/` that returns `IRNode[]`, **register it in `PDFRenderer.render()`**, export from
  `renderer/index.ts`, add a test under `tests/unit/<group>/` (mirror the source path; import the
  subject via `../../../src/lib/<group>/<module>`). A new drawable primitive also needs an `IRNode`
  variant in `ir/display-list.ts` + a `case` in `PdfBackend.serializeNode`.
- Units are PDF points (1/72"). Page formats in `constants/page-sizes.ts`.

## What's built, and the genuine gaps

The big refactors the roadmap set out are **done** (Phases 0-6, shipped as `@jasy/pdf@1.0.0-alpha.1`):

- ✅ **Pagination / fragmentation** — the old "last 15% / rattenschwanz wall" is solved. A pure
  `fragment(maxHeight, width, ctx) → { fitted, remainder }` protocol (`layout/fragmentation.ts`, shared
  `packChildren`): text splits at line boxes, padding/border clone per fragment, flex containers re-pack;
  the page driver loops the remainder into fresh pages, `header`/`footer` repeat. Positions are computed
  DURING fragmentation, not mutated onto shared instances — constraints down once, sizes up once.
- ✅ **One shared line-breaker** (`text/line-breaker.ts`) feeds measure, draw AND fragmentation; the old
  duplicated-wrapping divergence is gone.
- ✅ **Singleton killed** → explicit `LayoutContext` threading (Phase 2); mixed-page-size bug fixed.
- ✅ **Typed seams** — `BoxConstraints`/`Size`/`Offset` (Phase 4); `grep ': any' src/lib` empty.
- ✅ **Custom fonts** — TTF parse → Type0/Identity-H + `/FontFile2`, full Unicode, subsetted
  (`ttf-subsetter.ts`, `ABCDEF+` tag, ~97% smaller) + FlateDecode-compressed. Font names with spaces are
  `#XX`-escaped in the PDF `/Name` (`pdfName`).
- ✅ **Inheritable text styles** (Flutter `DefaultTextStyle`, 2026-06-24) — `Document({ font, size, color,
lineHeight, align, bold, italic }, …)` sets doc-wide text defaults; `DefaultTextStyle(opts, children)`
  re-defaults a subtree; per-property merge `explicit > inherited > built-in`, threaded via
  `LayoutContext.textStyle` (`text/text-style.ts`). Box/layout props never inherit — the CSS line.
- ✅ **Custom page formats** (2026-06-24) — `mm()` / pt: `Page({ size: mm(50, 65) })`; MediaBox + content
  box + Y-flip all honour `customSize`.
- ✅ **`onOverflow` safety** (2026-06-24) — over-tall unbreakable content is force-placed (clipped) so
  pagination always terminates (no infinite loop); render option `onOverflow: "error" (default) | "warn"
| "ignore"` (`fragmentation.ts packChildren`).
- ✅ **Encryption** (2026-06-28, `@jasy/pdf@alpha.4`) — AES-256, V5/R6 (ISO 32000-2, the newest standard).
  `renderToBytes(doc, { encrypt: { userPassword, ownerPassword?, permissions? } })`. Built on **WebCrypto**
  (`crypto/webcrypto.ts`, isomorphic, zero-dep) behind a pluggable **`SecurityHandler` seam**
  (`crypto/security-handler.ts`) — a future algorithm/revision is just a second impl. Streams encrypt at one
  choke-point (`streamPayload`) + a finalize pass (`finalizeEncryption`) writes `/Encrypt` + forces `/ID`;
  `EncryptMetadata false` keeps XMP plaintext. Mutually exclusive with PDF/A (ZUGFeRD throws). `recoverFileKey`
  (validates the password vs `/U`) is the groundwork for a future decrypt/edit path. Proven against poppler.
- ✅ **Color emoji — COLR/CPAL v0 + v1** (2026-07, branch `feat/emoji`, not yet merged) — real color emoji
  rendered as **vector layers in pure TS, no browser, no CDN** (react-pdf only does CDN-fetched Twemoji PNGs).
  `TTFParser` grew a `glyf`+`loca` outline parser (`getGlyphPath` → M/L/Q, quads), COLR **v0** (flat solid
  layers) **and v1** (`getColorGlyph` walks the paint graph: PaintColrLayers/PaintGlyph/PaintColrGlyph, Solid,
  Linear/Radial gradients, and the transform paints 12/14/16/18/20/22 threaded as an affine, PaintComposite as
  source-over) + CPAL palette. A new IR `Path` primitive (filled, `fill: Color | Gradient`) → `PdfBackend`
  emits fills / clips + `sh` shadings (`registerShading`: axial/radial + a Type-2/Type-3 color-stop function).
  `TextRenderer._expandColorGlyphs` splits a run into normal text sub-runs + one `Path` per color layer
  (transform + em-scale applied to outline AND gradient coords). Also **E0: astral-safe measuring** (code-point
  iteration in `getStringWidth`/ellipsis) + a **cmap fix** (read BOTH the BMP format-4 and astral format-12
  subtables) — a correctness win for all astral text, not just emoji. Verified: Twemoji (v0), BungeeSpice (v1
  gradients), full Noto Color Emoji (v1 transforms/composite) all render; a normal custom font stays
  **byte-identical to pre-emoji main** (subset/embed/compress untouched) + a ZUGFeRD invoice is still
  **veraPDF PDF/A-3b compliant**. A color font drawn as vectors is not embedded (no wasted `/FontFile2`).
  **Inline fallback** (`Document({ emoji })`): emoji work in one string/font — a code point the text font can't
  color-render comes from a doc-level source, either a fallback FONT (color glyphs, native vector) or an IMAGE/CDN
  source (`{ url, format }`, react-pdf-style Twemoji PNGs; `renderer/emoji-image.ts` + `text/emoji-codepoints.ts`
  classifier). Measuring + rendering share the source (rendering is now async for image fetches); single code
  points only (multi-cp flags/ZWJ/skin-tones deferred - single-cp covers ~95%+).
- ✅ **Accessibility / tagged PDF (PDF/UA-1)** (2026-07-01) — `renderToBytes(doc, { accessible, lang, title })`
  emits a full structure tree, **verified `isCompliant` by veraPDF** (local at `~/.jasy/verapdf/verapdf -f ua1`).
  Engine owns it; components only declare a role: `Text({ role: "h1".."h6"|"p" })`, `Image({ alt })` → Figure,
  `Table` → Table/TR/TH/TD (auto), decoration → Artifact. The **`StructTree`** (`utils/struct-tree.ts`) builds
  StructTreeRoot → nested StructElem + ParentTree; a leaf/container both `openElement(structId, role)`, containers
  `push`/`pop`. **Keyed by a stable `structId`** (base `PDFElement`, carried through fragmentation clones) so a
  paragraph or table split across pages stays ONE logical element (Acrobat-level). A layout-**transparent**
  **`StructGroup`** (`elements/layout/struct-group.ts`) wraps table rows/cells; it fragments only if its child
  does (`canFragment` veto → rows move whole, never clipped). Backend wraps each node `/Role <</MCID>> BDC…EMC`
  (untagged → `/Artifact **BMC**`); catalog gets `/MarkInfo`, `/StructTreeRoot`, `/Lang`, `/ViewerPreferences
/DisplayDocTitle`, pages `/Tabs /S`, TH `/Scope /Column`, XMP `pdfuaid:part 1` (`utils/ua-xmp.ts`). Off =
  byte-identical. Full conformance needs embedded fonts + a title (same as PDF/A). **~415 tests.**

Genuine remaining gaps / deferred:

1. **Absolute positioning — Stages 1+2 built** (2026-06-21). CSS-style: `Box({ relative: true })` is a
   positioning frame (the page is one too); `Positioned({ top,left,right,bottom }, child)` is out-of-flow
   and anchors to the nearest frame (negative offsets poke out); `Box({ overflow: "hidden" })` crops its
   children to the rounded box (an image in one is round-cropped for free). Tests + gallery `10-positioning`.
   Remaining: **`z-index`** (Stage 3, paint order within a frame) and a public `measure()` helper. See
   `todo.md` "Absolute-positioning layer".
2. **`slice` border mode** (a split box left open at the break) — `clone` is the default; needs per-side
   stroke control in the `Rect` IR. True multi-column too (the `packChildren`/region machinery exists).
3. **Browser support — DONE (2026-06-25): the engine renders PDFs 100% in the browser.** ESM + isomorphic:
   `zlib`→`fflate`, `Buffer`→`Uint8Array` (`utils/bytes.ts`), AFM bundled (`assets/font-data.ts`),
   `crypto`→vendored MD5 (`utils/md5.ts`), platform-port (`platform/{node-fs,browser-fs}.ts` + the `browser`
   field), and **FULL ESM** (`module: nodenext` + `.ts` source imports via `allowImportingTsExtensions` +
   `rewriteRelativeImportExtensions`; the emitted `.d.ts` are fixed post-build by `scripts/fix-dts-ext.mjs`,
   tsc gap TS#61037). Browser font/image INPUT via `Uint8Array` (`CustomBytesImage` + a `fonts`
   document-descriptor prop → `addFont`); jimp lazy-loaded so text never bundles it. `@jasy/vue` renders
   client-side (the playground "Showcase" proves custom .ttf + JPEG + v-for + computed). PNG in the browser is
   DONE too: `platform/browser-image.ts` decodes via OffscreenCanvas (transparency → `/SMask`), swapped for the
   jimp path by the `browser` field. Nice-to-haves left: compact-AFM (size), `addFontFromUrl()`. See todo.md.
4. `manual-test` has hard-coded machine-specific paths.
5. Font gaps: no TrueType kerning; only TTF / TrueType-flavoured OTF parsed (OTF/CFF, WOFF2 not yet).
   Bold/italic resolve via registered family variants with a clean fallback to `normal` (no faux styles).
   Color-emoji deferred (all on `feat/emoji`, none blocking): COLR v1 **rotate/skew** transforms (24-31 —
   Noto doesn't use them; not built without a test font), variable-font paint variants, **sweep** gradient,
   gradient `repeat`/`reflect` extend (drawn as `pad`), and **CFF** / **sbix**+**CBDT** bitmap color fonts
   (so Apple Color Emoji and the bitmap Noto build are unsupported — only glyf-outline COLR fonts render).

## Roadmap

The authoritative plan + ground rules live in **`todo.md`** (gitignored, repo root). Read it before
starting work. Working agreement: **phase by phase, Flo approves each gate, Claude never commits/pushes
unprompted, comments English + sensible, don't break the font math.**

Status: **LAUNCHED 2026-06-27**, still shipping alpha increments (no beta/rc/stable until the feature set is
complete — see `todo.md`). All five packages live on npm; **current (2026-07-02): `@jasy/pdf`@alpha.5,
`@jasy/zugferd`@alpha.2, `@jasy/cli`@alpha.4, `@jasy/vue`@alpha.5, `@jasy/nuxt`@alpha.4** (the alpha.5 cascade =
color emoji + PDF/UA). Repo public + locked, full CI + changelog +
bots in place (see Repo facts). The engine is **feature-complete for the alpha** — inheritance, `onOverflow`,
custom formats, the line-breaker fixes; **~415 tests green**. The **landing**
(`~/projects/jasy-landing` → **jasy.dev**) is built: showroom (9 cards), validator, docs, a home-page
roadmap section, and a full **SEO + AI-discoverability layer** (OG image, JSON-LD, `robots.txt`,
`llms.txt`, `sitemap.xml`).

**`@jasy/vue` — renders PDFs as Vue components IN THE BROWSER** (2026-06-25): "the react-pdf for Vue",
PURE PDF (no ZUGFeRD). A Vue `createRenderer` whose host nodes ARE the `descriptor.ts` nodes → `buildDocument`
→ `renderToBytes`. Since the engine is now ESM + isomorphic, `renderToPdf` lives in the main entry and runs
**client-side** (no server, no `/api/render` fetch-bridge); `./node` re-exports it for back-compat. `Jasy`-
prefixed components; custom fonts + images load as `Uint8Array` (`<JasyDocument :fonts="{ Name: bytes }">`,
`<JasyImage :src="bytes">`). The Vite playground (`cd packages/vue && pnpm play`) renders in-browser, incl. a
**"Showcase"** sample (custom .ttf + JPEG + v-for + computed). DONE since: typed props, Table + more
components; **`@jasy/vue@1.0.0-alpha.2`** — the `jasyVue` GLOBAL plugin was **REMOVED** (global registration
never resolves in `renderToPdf`'s fresh app; plain Vue = explicit imports, prefix is Nuxt-only). The
**`@jasy/nuxt` Nuxt module shipped** (`@1.0.0-alpha.1` — client OR server, zero-config; see Repo facts +
`packages/nuxt`). A `style`-object CSS layer + `@media` are **won't-do** (props + `DefaultTextStyle` cover styling;
media queries are meaningless for a fixed-size PDF). Wanted-additive instead: **relative/percentage sizing** +
**paint-only rotate** (1.x minors). Plus the 🔮 wish-list (read/edit existing PDFs, forms, security + signatures,
more e-invoice profiles, framework bindings). See `todo.md` "⭐ Active" + "🔮 Layout & styling".

## Repo facts

- **pnpm monorepo.** `@jasy/pdf` is the root (`src/lib/` is the library); siblings in `packages/`:
  `@jasy/zugferd` (e-invoicing), `@jasy/cli` (the `jasy` TUI), `@jasy/playground`, **`@jasy/vue`**
  (`packages/vue`) — author PDFs as Vue components, and **`@jasy/nuxt`** (`packages/nuxt`) — the Nuxt module
  (zero-config PDFs client OR server; shipped 2026-06-26). Barrel exports via
  `index.ts` at each level. GitHub org
  `jasy-pdf`, the lib repo is `jasy-pdf/jasy` (**public** since the launch, 2026-06-27).
- The **landing is a separate repo**, `~/projects/jasy-landing` → **jasy.dev** (Nuxt 4 + Nuxt UI 4 +
  Content 3). It has its **own CLAUDE.md + HARD RULES: never start/stop its dev server (Flo runs it),
  only Flo commits.** Package links there use **npmx.dev** (Daniel Roe's registry browser), not npmjs.com.
- License MIT, author Florian Heuberger. **Launched 2026-06-27** (Bluesky + npm; landed with the Vue/Nuxt core
  crew). npm current (alpha + latest dist-tags): `@jasy/pdf`@alpha.5, `@jasy/zugferd`@alpha.2, `@jasy/cli`@alpha.4,
  `@jasy/vue`@alpha.5, `@jasy/nuxt`@alpha.4 (released via `scripts/release.sh <pkg> <version>` → `<pkg>-v*` tag →
  CI publish; order matters, deps `workspace:*` pin EXACT so dependents re-release when a dep does; the tag also
  builds the GitHub Release notes via `scripts/gh-release.mjs` — changelogen groups + per-commit contributors,
  idempotent upsert). `latest` dist-tag points at the newest alpha per package.
- **Repo locked to the maintainer** (GitHub rulesets, 2026-06-27): only Flo's account pushes/merges/tags; everyone
  else = issues + fork PRs. **CodeRabbit** (`.coderabbit.yaml`) reviews PRs; **Renovate** (`renovate.json`, app
  bypass-listed in the ruleset) opens weekly dependency PRs. Community-health files (CONTRIBUTING / CODE_OF_CONDUCT /
  SECURITY / LICENSE / issue+PR templates / FUNDING) all in. Branch `main`. Runtime deps: `jimp` (images), `fflate`
  (isomorphic deflate); the old `reflect-metadata`
  DI is gone (decorator removed).
