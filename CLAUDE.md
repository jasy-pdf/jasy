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
- **Pagination is real.** A `fragment(maxHeight, width, ctx) → { fitted, remainder }` protocol
  (`layout/fragmentation.ts`, shared `packChildren`) splits content across pages: text at line boxes,
  padding/border cloned per fragment, flex containers re-packed. The page driver (`PDFDocumentRenderer`)
  loops the remainder into fresh physical pages; `header`/`footer` repeat on each.
- **The Y-flip lives at the IR→backend seam, NOT in elements.** Elements lay out in a top-left
  origin and are coordinate-blind; `PdfBackend.flipY(nodes, pageHeight)` flips once per page. `grep
normalizeCoordinates src/` is empty.

### Pass 2 — render: display list → backend (the IR seam)

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
  to PDF's bottom-left once per page at this seam — no element does a Y-flip.

### The PDF writer — `PDFObjectManager` (`utils/pdf-object-manager.ts`)

The hand-rolled core. Holds the indirect-object array, tracks byte offsets for the xref table, manages
fonts and images, and owns config. Also the **font-metrics engine**: parses the 14 standard-font AFM
files (`assets/*.afm` via `AFMParser`) to compute `getStringWidth` / `getCharWidth` — this is what makes
text wrapping possible without a browser. **We kern** — on by default (opt out with
`renderToBytes(doc, { kerning: false })`). PDF never kerns on its own, so a kerned run is emitted as a `TJ`
array whose per-gap adjustments come from the font: `AFMParser.getKerning` for the standard-14, the `kern`
table + `GPOS` for embedded fonts. Measuring uses the SAME adjustments in ONE place (`text/advance.ts`
`runAdvance`, gated on `metrics.kerningEnabled`), so **measured equals drawn** — the original bug was the
reverse: `getStringWidth` folded the kern pairs into the MEASUREMENT while the `Tj` output ignored them, so
every kerned string drew wider than its box ("AVATAR Wave" at 40pt by 19pt, "Total" at 11pt by 5.7%). Now the
measurement is plain glyph widths and kerning is added in that one canonical place; with kerning off, the
output is byte-identical to the plain-`Tj` past. Standard text is encoded as Windows-1252 /
WinAnsiEncoding (`utils/utf8-to-windows1252-encoder.ts`). **Custom TrueType fonts** plug in beside this:
`TTFParser` (`utils/ttf-parser.ts`) reads the same metrics straight from the `.ttf` (hmtx/cmap), and
`registerCustomFont` embeds the font as a Type0/Identity-H graph (`/FontFile2`) — the metric + emission
paths branch on the font name (`isCustomFont`), leaving the AFM/WinAnsi path byte-identical. `TTFParser`
also parses `glyf`/`loca` outlines + COLR/CPAL color tables for color emoji (see the ✅ Color emoji entry).

#### Font VERTICAL metrics — read this before touching a baseline

Two different kinds of number live in a font, and mixing them up cost us ISSUE-5. **Read the right one.**

- A **glyph metric** says how tall one letter is: AFM `Ascender 718` is the height of `b`/`d`/`h`;
  `CapHeight 718`, `XHeight 523`. Useful for drawing (an underline, a strikethrough), useless for stacking
  lines.
- A **line metric** says how far a line must reach from its baseline so nothing collides: TrueType's
  `hhea.ascent` / `hhea.descent` / `hhea.lineGap`. It is much taller than the letters, because it has to
  clear an accented capital — Arial declares `ascent 0.905` where its capitals only reach `0.716`.

**The standard-14 line metric is the `FontBBox`, not `Ascender`.** Helvetica: `-166 -225 1000 931` → ascent
`0.931`, descent `0.225`, and no lineGap left to speak of. That is within a hair of a real Helvetica clone's
`hhea`. `AFMParser.verticals()` returns exactly this; `PDFObjectManager.getFontVerticals(family, style)`
answers from `hhea` for an embedded face and from the bbox for a standard-14 one (memoised per face).

**Why a line box built this way looks right:** the surplus above the capitals (`0.931 − 0.718 = 0.213`) is
about the same as the descent below the baseline (`0.225`). So an all-caps word lands optically centred in a
box with equal padding. Seat the baseline at `Ascender` instead and every capital sits ~0.2 em too high —
invisible on `Hxg` (the `g` hides it), glaring on `PAID` in a bordered box. **Always test with an all-caps
word in a box with equal padding.** The reference is `google-chrome --headless --print-to-pdf` on the
equivalent HTML (installed; scripts in `claude-data/out/lineheight/`), not react-pdf and certainly not
reasoning from our own code.

react-pdf hard-codes `ascent = 900` for every standard font, commented "based on empirical observation".
That is a **rounded `FontBBox`**, not a guess. For embedded fonts it reads real `hhea` values, like we do.

**Glyph metrics, for decoration**: AFM gives `UnderlinePosition -100`,
`UnderlineThickness 50`, `CapHeight`, `XHeight`; TrueType the same in `post` + `OS/2` (`sxHeight`,
`sCapHeight`, version ≥ 2, else measured off the `x`/`H` outline). Surfaced by
`FontMetrics.getFontDecoration` and consumed by `text/text-decoration.ts` — kept in a SEPARATE module from
`line-metrics.ts` precisely so a glyph metric can never again be used as a line metric. **Do not invent a
constant** — that is exactly how `BASELINE_RATIO = 683/1000` happened. `letterSpacing` is still to come.

### The one identity-sensitive place in the engine — read before shipping a wrapper

`RendererRegistry` (`utils/renderer-registry.ts`) is a `Map<Function, Function>` **keyed on the
element's constructor**. Everything else in jasy survives two copies of the library being loaded -
building elements, layout, font metrics, byte writing. This one does not.

It used to fail **silently**: seventeen call sites read `const renderer = getRenderer(el); if
(renderer) { … }` with no `else`. Two instances → every element skipped → a valid PDF with embedded
fonts and an empty content stream. Same hazard as "two copies of React", minus the error message.
**It THROWS** (`MissingRendererError`), and the message names both causes - an
unregistered element, or two copies of `@jasy/pdf`. The dead guards are gone. Note the corollary: the
registry keys on the EXACT constructor, so a SUBCLASS of a registered element is not registered either
and now throws - deliberate, because silently borrowing the parent's renderer would draw the parent.

**This bit us for real** (ISSUE-11): `@jasy/nuxt` injects auto-imports into the
CONSUMER's code (`addServerImports({ from: "@jasy/pdf" })`), so under pnpm the consumer's route and
the module's runtime resolved `@jasy/pdf` to two module records. Blank page in `nuxt dev`; `nuxt build`
and the monorepo playground both hid it.

**The rule that follows:** a package whose names you inject into someone else's code must be a
**peer dependency**, or the injector must resolve the path itself and inject that. Exact version pins
answer a different question - they fix VERSIONS, not module IDENTITY.

**The fix**, and the mechanism was NOT what it looked like: there was one physical copy on
disk. Nitro resolves the CONSUMER's server code and the module's own runtime separately, so one server
build held two module records. `nitro.alias` on the resolved path pins them together; `@jasy/pdf` and
`@jasy/vue` became peer dependencies of `@jasy/nuxt` so a consumer cannot install a second copy either.
Two things measured along the way that are worth NOT re-testing: `nitro.externals.inline` does not fix
it, and the `browser` field is not involved (the main entry has no browser condition).

### State threading — explicit, no singleton

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
- This shape is what the fragmentation pass needs: it threads exactly metrics +
  per-page geometry, nothing more. A `relative` positioning frame would thread one more geometry here.

## Element & renderer inventory

| Element                 | File                                         | Renderer               | Notes                                                                                     |
| ----------------------- | -------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `PDFDocumentElement`    | `elements/pdf-document-element.ts`           | `PDFDocumentRenderer`  | root, holds pages                                                                         |
| `PageElement`           | `elements/page-element.ts`                   | `PageRenderer`         | per-page `config` (size/orientation/margin)                                               |
| `ContainerElement`      | `elements/container-element.ts`              | `ContainerRenderer`    | sized box, flex column of children                                                        |
| `TextElement`           | `elements/text-element.ts`                   | `TextRenderer`         | string or `TextSegment[]` (mixed font/size/color), alignment, word-wrap                   |
| `PaddingElement`        | `elements/layout/padding-element.ts`         | `PaddingRenderer`      | margin `[top,right,bottom,left]`, sizes to child                                          |
| `ExpandedElement`       | `elements/layout/expanded-element.ts`        | `ExpandedRenderer`     | flex child, fills remaining height                                                        |
| `SizedContainerElement` | `elements/layout/sized-container-element.ts` | —                      |                                                                                           |
| `ImageElement`          | `elements/image-element.ts`                  | `ImageRenderer`        | via `jimp`; `BoxFit`, grayscale; `CustomLocalImage`                                       |
| `LineElement`           | `elements/line-element.ts`                   | `LineRenderer`         | stroke                                                                                    |
| `RectangleElement`      | `elements/rectangle-element.ts`              | `RectangleRenderer`    | fill + stroke                                                                             |
| `Color`                 | `common/color.ts`                            | —                      | RGB → PDF color string                                                                    |
| `LinkElement`           | `elements/layout/link-element.ts`            | `LinkRenderer`         | `href` (URL) or `dest` (an `Anchor`) → a /Link annotation                                 |
| `AnchorElement`         | `elements/layout/anchor-element.ts`          | `AnchorRenderer`       | named jump target → catalog /Names /Dests                                                 |
| `BookmarkElement`       | `elements/layout/bookmark-element.ts`        | `BookmarkRenderer`     | outline entry, nested by `level` → /Outlines                                              |
| `RotatedElement`        | `elements/layout/rotated-element.ts`         | `RotatedRenderer`      | paint-only spin at any angle (stamps)                                                     |
| `RotatedBoxElement`     | `elements/layout/rotated-box-element.ts`     | `RotatedRenderer`      | layout-aware quarter-turns (vertical labels)                                              |
| `PageBuilderElement`    | `elements/layout/page-builder-element.ts`    | `PageBuilderRenderer`  | builds from `PageInfo` (pageNumber/pageCount/pageSize)                                    |
| `PageBreakElement`      | `elements/layout/page-break-element.ts`      | `PageBreakRenderer`    | forced page break; zero-size, packer cuts at it (`forceBreak` bubbles up)                 |
| `KeepTogetherElement`   | `elements/layout/keep-together-element.ts`   | `KeepTogetherRenderer` | transparent wrapper; vetoes a page-split (break-inside: avoid), degrades if > 1 page      |
| form fields (6 classes) | `elements/forms/*.ts`                        | `FormFieldRenderer`    | AcroForm widgets; reserve a rect, emit a widget annotation. Shared spec: `forms/field.ts` |
| `SvgElement`            | `elements/svg-element.ts`                    | `SvgRenderer`          | an SVG drawing; parsed at construction, `svg/` turns it into `Path` IR                    |
| `CanvasElement`         | `elements/canvas-element.ts`                 | `CanvasRenderer`       | a box drawn by a callback; `canvas/painter.ts` records into `Path` IR                     |

Every renderer's `render()` returns `Promise<IRNode[]>`. Adding an element =
new element + renderer that returns IR + (if it draws something new) a primitive in `ir/display-list.ts`
plus a `case` in `PdfBackend.serializeNode`. Register the renderer in `PDFRenderer.render()`.

## The intuitive API layer (`src/lib/api/`)

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

**Package manager is pnpm** (`pnpm-lock.yaml` committed). Use `pnpm` / `pnpm exec`, not `npm`/`npx`.

- `pnpm test` — Vitest (watch). `pnpm exec vitest run` for a one-shot CI-style run.
  `pnpm run test:coverage` for coverage. Unit tests live in **`tests/unit/`**, mirroring the `src/lib/`
  structure (`tests/unit/{common,elements,renderer,utils}/…`). `src/` is pure production code — the
  build (`tsconfig.json` includes only `src/**`) therefore keeps `dist/` test-free. The root run covers
  the core plus `@jasy/cli`, `@jasy/vue` and `@jasy/e-invoice`; `@jasy/nuxt` is excluded
  (`vitest.config.ts`) and runs on its own. The count is whatever `pnpm exec vitest run` prints, not
  a number written here.
- `pnpm run build` — `tsc` → `dist/`. **The sibling packages import `@jasy/pdf` and `@jasy/e-invoice`
  from `dist`** - build before you measure or type-check them, or you are looking at the old engine.
- `pnpm run lint` (oxlint) + `pnpm run fmt:check` (oxfmt `--check`); `pnpm run fmt` formats. **Run `pnpm run fmt`
  before committing** — CI fails on unformatted files.
- **CI** (`.github/workflows/`): `pr.yml` = the PR gate (PR-title lint → lint+fmt → build →
  only-changed tests via `vitest --changed`, staged + fail-fast, Node 24); `ci.yml` = full suite on `main`
  (Node 22 + 24); `release.yml` = publish + GitHub Release on a `<pkg>-v*` tag.
- `pnpm run manual-test` — compiles via `tsconfig.test.json`, copies AFM assets, runs
  `tests/manual/index.ts` (renders the `showcase.ts` capability demo). `tests/manual/` is **gitignored**
  — a DX/showcase harness that reads sample images from the private `claude-data/` scratch, so it isn't
  self-contained for a fresh clone. To become a polished public example later (committed clean assets).
  For a quick visual check, prefer `claude-data/render.sh` (above).
- Note: the core package is now named `@jasy/pdf` (npm scope `@jasy`, GitHub org `jasy-pdf`). It is the
  pnpm-workspace root; the ZUGFeRD work lives in `packages/e-invoice` (`@jasy/e-invoice`).

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
  subject via a relative path to `src/lib/<group>/<module>.ts` — count the `../` from the test's OWN
  depth (`tests/unit/<group>/` needs three, `tests/unit/elements/layout/` four) and **keep the `.ts`
  extension**, which `nodenext` requires; without it the module resolves to `any` and a real type error in the test is invisible, see
  ISSUE-6). A layout test needs a `FontMetrics`: use `testMetrics()` from `tests/unit/support/metrics.ts`
  rather than a hand-rolled literal, so the object really satisfies the interface instead of being cast
  past it. A new drawable primitive also needs an `IRNode` variant in `ir/display-list.ts` + a `case` in
  `PdfBackend.serializeNode`.
- Units are PDF points (1/72"). Page formats in `constants/page-sizes.ts`.

## Traps - what bit us, and the rule each one left behind

No dates, no test counts. Each of these cost a real bug; the git log has the story, this has the rule.

**Measured ≠ drawn is THE bug family.** Every text fault we ever shipped was one path computing a
width or a height and another path drawing something else. The cure is always the same: ONE function
owns the number and every caller uses it. `text/advance.ts` (`runAdvance`) owns the horizontal
advance, `text/line-metrics.ts` (`lineBoxFor`) the vertical, `text/line-breaker.ts` the breaking, and
`singleLineWidth` the sum a `Text` in a `Row` is sized by - which exists because `(word + space)` and
`word + (space + word)` differ by one bit in floating point and that bit wrapped a footer. If you find
yourself computing an advance, a baseline or a fit anywhere else, stop.

- The breaker's fit test must include the **joining space**; forgetting it let every line after the
  first overrun by one space, invisible on the first line where a spurious space cancelled it out.
- `textTransform` is applied at ONE choke point, `TextElement.display()`, that measure, break and draw
  all read - recasing at draw time measures `world` and draws `WORLD`.
- Font fallback splits into spans in the LAYOUT pass and REMEMBERS the split; the render pass has no
  metrics and would draw everything in the first family.
- Arabic is shaped on the LOGICAL text and its glyphs reversed after; shaping the visual order gives a
  word 42.5 pt where 34.4 is right, and both passes agree so nothing looks wrong.
- Kerning is OFF for a shaped run (pairs are keyed by unshaped glyphs); `letterSpacing` counts DRAWN
  glyphs, since a ligature is one glyph for two code points. `PdfBackend.kernedArray` THROWS on a
  length mismatch - a short list once silently dropped the last glyph of "Verpflichtung".
- `%` children in a flex line resolve against **the line minus its gaps**, in BOTH the measure and the
  wrap pass; a mismatch wrapped the third of three 33% chips for no reason.
- Page numbers are drawn after the whole document is paginated, so `pageCount` exists on page 1. The
  cost: dynamic BODY content reserves its box from a provisional "1 of 1" build, and a conditional
  header may SHRINK on later pages but never GROW.

**Glyph metric ≠ line metric** - see the font-verticals section above. Never invent a constant; that is
how `BASELINE_RATIO = 683/1000` happened. Test with an ALL-CAPS word in a bordered box.

**Two copies of the library** - see the registry section above. A package that injects names into a
consumer's code must be a PEER dependency. Exact version pins fix VERSIONS, not module IDENTITY.

**Packages read the engine from `dist`.** `packages/vue`, `packages/cli` and the e-invoice types all
resolve `@jasy/pdf` / `@jasy/e-invoice` from the built output. **Build first or you measure the old
engine** - a whole wrong diagnosis was once built on a debug line that never printed.

**Non-finite numbers.** A flex child on an UNBOUNDED main axis resolved to `Infinity`, which became
every later sibling's offset and was written into the content stream as `-Infinity Td`; viewers drop
the stream from there, so siblings and the footer vanished. Flex collapses to `0` on an unbounded axis,
`PdfBackend.assertFinite` refuses to serialize a non-finite number, and a stack holding a flex child
asks its parent for a bounded main axis (`needsBoundedMain`).

**A step that shrinks nothing ends the loop.** Flo's termination rule for pagination, replacing "N
attempts": every physical page has the full body height, so `fitted === null` on a whole page means
the region cannot shrink and we place it whole (clipped), report the overflow, and stop.

**Hot paths and string keys.** The per-character lookups once built string keys and the engine was
4.8x slower for it. Nested maps on primitives, never composed strings, in anything called per glyph -
and MEASURE after every single change: the profiler says WHERE time goes, not WHAT helps. Two "fixes"
were 3x slower.

**fflate does not throw on an over-long inflate, it TRUNCATES silently.** `inflateBounded` streams the
input in slices and checks the total as it grows (`PdfStreamTooLargeError`, 64 MB default); the
obvious `unzlibSync(data, { out })` would have replaced an OOM with quiet data corruption.

**Every string goes through `PDFObjectManager.pdfString()`.** Encryption once enciphered streams only;
a form field's `/T`, every bookmark `/Title`, link `/URI` and `/DA` sat in the encrypted file in plain
text - a leak in RELEASED code. `pdfString()` is the one choke point, mirroring `streamPayload()`: no
handler → the escaped literal, a handler → registered and swapped for ciphertext at finalize. A new
emitter that writes a string any other way reopens the leak.

**`sh` floods the current clip.** PDF has no gradient FILL colour, so a gradient box becomes the clip,
the shading paints inside it, and the border is stroked afterwards on its own.

**A stale appearance is a self-contradicting document.** Producers that DRAW their form fields leave a
picture of the old value; writing a new `/V` while keeping the old `/AP` shows nothing until clicked.
Drop `/AP` for `Tx`/`Ch` on fill; a BUTTON's `/AP` holds its states and stays, only `/AS` moves. And
flatten reads the picture out of the DOCUMENT, so a filled-and-flattened form freezes the value from
BEFORE the fill unless the fresh appearance is handed over explicitly.

**A `.notdef` fails PDF/A** (ISO 19005-3, 6.2.11.8). A code point no font can draw is REMOVED and
REPORTED (`onMissingGlyphs`, `droppedCharacters`), with a plain equivalent substituted where one means
the same (U+2011 → `-`, or `E-Rechnung` becomes `ERechnung`). `\n` is a HARD line break, normalised
once in the `TextElement` constructor. This reversed an earlier "show `.notdef` like a browser"
decision: completeness outranks browser parity.

**`svg-parser` coerces any numeric-looking attribute** - `id="1e999"` came back as `Infinity` and broke
`url(#id)`. We wrote our own XML reader. Two more from the 10,819-file corpus: the root `<svg>` is a
VIEWPORT and clips to itself, and its own presentation attributes must be read - `fill="none"` on the
root (Figma's default) otherwise paints every unfilled shape BLACK.

**bidi-js's `getMirroredCharactersMap` wants the LEVEL ARRAY**, not the result object its README
passes; the README way returns an empty map and no bracket is ever mirrored. Our own test was green
because it asserted the broken order. A **surrogate pair is two code units at one level**; a naive
reversal splits an emoji in Hebrew text.

**The `cmap` has TWO subtables that matter** - BMP format 4 AND astral format 12. Read both, and
iterate CODE POINTS everywhere (`getStringWidth`, ellipsis, fallback), or an astral character is
measured as two halves.

**A fixture shaped by the consumer cannot find what the consumer lacks.** The CLI round-trip test ran
for weeks on an invoice described as "every field the parser handles" and could therefore never notice
a field the parser did not handle. Exhaustive fixtures are shaped by the MODEL and TESTED as exhaustive
(`fixture-is-maximal`); every symmetry test (paper↔XML, CII↔UBL, write↔read) runs against that one.

**`fixture-is-maximal` matches a field NAME anywhere in the file.** Known weakness, unfixed:
`baseAmount`/`percent` passed vacuously once `cashDiscounts` introduced those names.

**Comments describe what breaks on the NEXT grab, not what broke on the last one.** Bug archaeology
("this looked for the wrong tag", "it was silence for a day") belongs here or in git, never in source.
The same rationale written in six files is five future lies - it lives ONCE, at the choke point that
enforces it (`skonto.ts` for "Skonto is not an allowance"), and everywhere else is a line or nothing.

## Decisions that hold - do not relitigate

- **Kerning, ligatures ON by default**; `flexShrink: 1` (the CSS default) with a `min-content` floor
  (`minIntrinsicMain`), where the gate for a behaviour change is "every changed case is BETTER", not
  "nothing changes" - four gallery cases were overflowing the page margin unseen.
- **`breakWord` and `hyphenate` OFF by default**, as CSS. Hyphenation is a **hook**, not bundled data
  (German patterns alone are 732 KB); the `hyphen` adapter is one line and is EXECUTED by a test. No
  `@jasy/hyphenation` package. We do not hyphenate until you name the language; react-pdf hyphenates
  German by English rules.
- **Box/layout props never inherit; text styles do** (`explicit > inherited > built-in`, via
  `LayoutContext.textStyle`). The CSS line.
- **`lineHeight` unset = the font's natural line height**; a number = a multiplier of the font size.
- **Sizing order follows CSS**: relative → aspect ratio fills the open axis → min/max clamp. `%` insets
  resolve against the WIDTH on all four sides (Yoga does the same). Per-corner radii sharing an edge
  scale down TOGETHER (react-pdf clamps each alone). A `max-width` caps, it never grows.
- **Justification moves the pen, never `Tw`** (`Tw` reaches only byte 32, so it misses every embedded
  font). Squeeze up to a quarter space to keep a word; the last line is never STRETCHED.
- **`textAlign: start` is the default**, resolved to left in ltr and right in rtl at the one place
  alignment is consumed. That is what makes an rtl paragraph begin on the right unasked.
- **Encryption: WRITE R6 only, READ R2-R6.** Writing a broken scheme hands a user false protection
  (PDFKit and react-pdf default to 40-bit RC4). Exclusive with PDF/A. Byte-stability is per library
  VERSION and excludes encrypted output (random salts, fresh IVs - by design).
- **Byte-stable output**: no `/CreationDate`/`/ModDate`, trailer `/ID` is a content hash. Pinned by a
  test with a counter-test so it cannot pass vacuously.
- **The engine owns accessibility; components declare a role.** `structId` survives fragmentation so a
  split paragraph stays ONE element.
- **An ineffective `PageBreak` is ignored, with ONE `console.warn`** (react-pdf ignores `<View break>`
  in a row too). `keepTogether` vetoes a split, defers whole, and DEGRADES if taller than a page.
- **Colour emoji: pure-TS vectors, no CDN by default**; an IMAGE fallback source is opt-in. Single code
  points only (~95%); flags/ZWJ/skin tones deferred.
- **SVG and Canvas: the edge of the subset is a NAMED error, never a silent skip.** Supporting
  something new turns an error into a picture, which cannot break a document that worked. Canvas has
  no hidden state (no `lineWidth(2)` a later `stroke()` picks up) and one coordinate system.
- **WOFF/WOFF2 unwrap at the ONE point every font path meets** (`registerCustomFont` / `renderPdf` for
  the async Brotli). The WOFF2 `glyf` transform is ours; only Brotli is bought.
- **`bidi-js` sits behind `text/bidi.ts` and nothing else knows it exists** - replacing it is a
  one-file change. GSUB executes lookup types 1, 4, 7 and REPORTS the rest; `fontFeatureSettings` is
  not exposed because we would be promising types we do not run.
- **A `Positioned` with no frame THROWS** (it used to draw in the page corner). The page's frame is
  its content box, threaded into header, footer and body alike.
- **Font URLs resolve at REGISTRATION**, like a file path - a dead link fails on the line that asked.
  15 s timeout, 32 MB ceiling enforced while the body arrives, `FontUrlError`.
- **Element constructors take one options object; renderers read `getProps()`, never privates;
  PDF operators live only in `PdfBackend`.**

## Genuine remaining gaps

1. **`z-index`** within a positioning frame (Stage 3 of absolute positioning) and a public `measure()`.
2. **`slice` border mode** at a page break (a split box left open) and true multi-column.
3. **OTF/CFF fonts** are not parsed (TTF, TrueType-flavoured OTF, WOFF1, WOFF2 are). Colour-emoji
   deferrals: COLR v1 rotate/skew, variable paints, sweep gradients, CFF/sbix/CBDT bitmap fonts (so no
   Apple Color Emoji).
4. **A transform does not carry its side channels** - `Link`/`Anchor`/`Outline` are page `/Annots` and
   never see the `cm` matrix, so a rotated link keeps an un-rotated hit area. react-pdf gets it WRONG
   rather than missing (measured); a matrix stack at the `flipY` seam → `/QuadPoints` would make us
   the only one right. LOW.
5. **XMP stays unencrypted** (`/EncryptMetadata false`, the industry norm), so the title is readable
   without the password in accessible mode.
6. **The test tree is not type-checked** (ISSUE-6): `tsc` covers `src/**` only; tests that import
   without the `.ts` extension resolve to `any`. New tests follow the convention above; the backlog
   does not.
7. **Bidi mirroring SUBSTITUTES the character** (as react-pdf does) where Chrome mirrors the glyph, so
   extracted text has swapped brackets. **GPOS mark positioning** and GSUB type 6 are not built;
   react-pdf does neither either (measured).
8. `breakWord`/`hyphenate` are read per `Text`, not per `span` (ISSUE-13).
9. `manual-test` has machine-specific paths.

## Roadmap, packages, repo

The plan and its order live in **`todo.md`** (gitignored, repo root) - read it first. Working
agreement: **phase by phase, Flo approves each gate, Claude never commits or pushes, comments in
English and short, do not break the font math.**

- **pnpm monorepo.** `@jasy/pdf` is the root (`src/lib/`); `packages/`: `e-invoice` (ZUGFeRD /
  XRechnung, **own CLAUDE.md there**), `cli` (the `jasy` TUI: validate, read, export), `vue` (PDFs
  as Vue components, PURE PDF, renders in the browser), `nuxt` (zero-config, client or server),
  `playground`. GitHub org `jasy-pdf`, repo `jasy-pdf/jasy`, public, locked to the maintainer
  (rulesets); CodeRabbit reviews PRs, Renovate opens weekly dependency PRs.
- **Release**: `scripts/release.sh <pkg> <version>` bumps, commits, tags `<pkg>-v*`; CI publishes and
  writes the GitHub Release (`scripts/gh-release.mjs`). Siblings depend by RANGE (`workspace:^`) and
  `@jasy/pdf` is a PEER of `vue` and `nuxt`, so an engine patch needs one release, not five - and a
  consumer cannot end up with two copies. Current versions: npm, not this file.
- **The landing is a separate repo**, `~/projects/jasy-landing` → jasy.dev (Nuxt 4). Own CLAUDE.md,
  HARD RULES: never start or stop its dev server, only Flo commits. Package links use npmx.dev.
- **`@jasy/vue`'s typed props are held to the engine by a test** (`packages/vue/tests/text-props.test.ts`
  reads the option names out of `src/lib/api/text.ts`); the components forward `{ ...attrs, ...props }`,
  so an undeclared prop still WORKS, which is how eight options once drifted in unnoticed. A
  `style`-object CSS layer and `@media` are won't-do.
- License MIT, author Florian Heuberger. Runtime deps: `jimp`, `fflate`, `svgpath`, `bidi-js`,
  `brotli` (lazy). The SVG XML reader is ours.
