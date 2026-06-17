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

### Pass 1 — `calculateLayout(parentConstraints)`

- Defined on every element (`PDFElement.calculateLayout`). Constraints flow **down**; each element
  mutates its own `x/y/width/height` and returns a `LayoutConstraints` back up.
- `FlexLayoutHelper` (`utils/flex-layout.ts`) does vertical flex distribution: fixed-size children
  are measured first, remaining height is split among `ExpandedElement`s by `flex`.
- **Coordinate flip:** elements build in an intuitive top-left origin, then each calls its own
  `normalizeCoordinates()` to flip Y into PDF's bottom-left origin (`y = pageHeight - y - height`).
  Text additionally offsets by the font baseline (`maxLineHeight * 683/1000`).

### Pass 2 — render: display list → backend (the IR seam, since roadmap Phase 1)

The render pass is split at a hard seam — **the display list (IR)** — so the PDF byte writer never
sees a component:

- **Producers** (`src/lib/renderer/*`, one class per element, dispatched via `RendererRegistry` keyed
  on the element's constructor): each `render(element, objectManager)` returns an **`IRNode[]`**, not
  a string. Leaves (`TextRenderer`→`TextRun[]`, `LineRenderer`, `ImageRenderer`, `RectangleRenderer`)
  emit primitives; structural renderers (`Container`/`Expanded`/`Padding`, and `Rectangle` for its
  children) **concatenate** their children's lists. Producers still know about components and still do
  layout-ish work (text wrapping lives in `TextRenderer._buildRuns` until roadmap Phase 3).
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
- ⚠️ Coordinates in the IR are still already-Y-flipped (producers call `normalizeCoordinates`).
  Centralizing the flip at the IR→backend seam is roadmap Phase 3, not done yet.

### The PDF writer — `PDFObjectManager` (`utils/pdf-object-manager.ts`)

The hand-rolled core. Holds the indirect-object array, tracks byte offsets for the xref table, manages
fonts and images, and owns config. Also the **font-metrics engine**: parses the 14 standard-font AFM
files (`assets/*.afm` via `AFMParser`) to compute `getStringWidth` / `getCharWidth` / kerning — this
is what makes text wrapping possible without a browser. Standard text is encoded as Windows-1252 /
WinAnsiEncoding (`utils/utf8-to-windows1252-encoder.ts`). **Custom TrueType fonts** plug in beside this:
`TTFParser` (`utils/ttf-parser.ts`) reads the same metrics straight from the `.ttf` (hmtx/cmap), and
`registerCustomFont` embeds the font as a Type0/Identity-H graph (`/FontFile2`) — the metric + emission
paths branch on the font name (`isCustomFont`), leaving the AFM/WinAnsi path byte-identical.

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
- This shape is intentionally what the future fragmentation pass (roadmap Phase 5) needs: it threads
  exactly metrics + per-page geometry, nothing more.

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
  build (`tsconfig.json` includes only `src/**`) therefore keeps `dist/` test-free. **81 tests, green.**
- `pnpm run build` — `tsc` → `dist/`.
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

## Known weak spots & the refactor that matters

1. **No real pagination yet.** `calculateLayout` is a single-pass, **mutation-based**, single-page
   model. There is no fragmentation: nothing splits an element across pages, and an overflow cascade
   re-invalidates ancestors with no fixpoint — this is exactly the "rattenschwanz" wall (text breaks →
   border breaks → enclosing text breaks → … now inside a split-view → boom). The intended fix is a
   **pure, recursive `{ fitted, remainder }` fragment protocol** (Flutter RenderObject / CSS
   fragmentation style): constraints flow down once, sizes flow up once, no information flows back up
   after a break. Each element owns its own split strategy (text → line boxes; image → atomic, moves
   whole; padding/border → emits two fragments, `box-decoration-break: slice|clone` decided locally;
   columns → a fragmentation context that re-packs its remainder). Design the engine **width-stable**:
   widths finalized in the measure pass, only height fragments — this keeps it O(content), terminating,
   and loses nothing for documents.
2. **Duplicated text-wrapping logic.** `TextRenderer.calculateTextHeight` (measure) and
   `TextRenderer._buildRuns` (the IR producer) each re-implement word wrapping independently — they can
   diverge (measured height ≠ produced lines). A single shared line-breaker feeding both is the clean
   fix and a prerequisite for trustworthy fragmentation. **This is roadmap Phase 3's first task.**
3. ~~**Global mutable singleton** + the mixed-page-size config bug.~~ **FIXED in roadmap Phase 2** —
   the singleton is gone (explicit `LayoutContext` threading, see "State threading" above) and per-page
   config is resolved per page, so mixed-size docs place content correctly. Guarded by
   `tests/unit/elements/page-config.regression.test.ts` + `…/renderer/document-independence.test.ts`.
4. **Mutating, single-page layout.** `calculateLayout` still mutates each element's absolute x/y once —
   fine for one page, but fundamentally incompatible with fragmentation (an element split across pages
   needs several positions). The mutating body gets replaced by the `{fitted, remainder}` fragment pass
   in roadmap Phase 5; the `LayoutContext` plumbing built in Phase 2 is what survives.
5. ~~**README over-promises** custom font embedding.~~ **DONE** — TrueType embedding works end-to-end
   (`TTFParser` → Type0/Identity-H + `/FontFile2`, `renderPdf(doc, { fonts })`), full Unicode, copy-able.
   Only the size optimisation (subsetting) + OTF/CFF/WOFF2 formats remain.
6. `manual-test` has hard-coded machine-specific paths.
7. **Custom fonts embed the FULL font** (no subsetting yet) → large PDFs; no TrueType kerning. Deferred,
   not correctness bugs. (Bold/italic now work via registered family variants with a clean fallback to
   `normal`; we don't _synthesise_ faux styles, which is correct behaviour, not a gap.)

## Roadmap

The authoritative plan + ground rules live in **`todo.md`** (gitignored, repo root). Read it before
starting work. Working agreement: **phase by phase, Flo approves each gate, Claude never commits/pushes
unprompted, comments English + sensible, don't break the font math.**

Status: **Phase 0 done** (font-metric oracle tests). **Phase 1 done** (IR seam — components → IR →
backend). **Phase 2 done** (singleton killed → explicit `LayoutContext` threading; mixed-page-size bug
fixed; 81/81). **Next: Phase 3** — pull layout out of the components (first task: unify the duplicated
text wrapping into one shared line-breaker), then move `normalizeCoordinates` into the engine.
Later: Phase 4 types, Phase 5 fragmentation, Phase 6 ZUGFeRD/XRechnung (EN-16931 XML + PDF/A-3 backend
as a second IR consumer).

## Repo facts

- Single package, `src/lib/` is the library, barrel exports via `index.ts` at each level.
- License MIT, author Florian Heuberger, version 0.0.1.
- Branch `main`. Feature branches on origin: `decorator-test`, `image-element-feature`,
  `line-feature`, `page-settings`, `text-segments-feature`, `unit-testing`.
- Runtime deps: `jimp` (images), `reflect-metadata` (DI, now unused — pending removal).
