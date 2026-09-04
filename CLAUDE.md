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
files (`assets/*.afm` via `AFMParser`) to compute `getStringWidth` / `getCharWidth` — this is what makes
text wrapping possible without a browser. **We kern** — on by default since 2026-07-11 (opt out with
`renderToBytes(doc, { kerning: false })`). PDF never kerns on its own, so a kerned run is emitted as a `TJ`
array whose per-gap adjustments come from the font: `AFMParser.getKerning` for the standard-14, the `kern`
table + `GPOS` for embedded fonts. Measuring uses the SAME adjustments in ONE place (`text/advance.ts`
`runAdvance`, gated on `metrics.kerningEnabled`), so **measured equals drawn** — the 2026-07-10 bug was the
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

**Glyph metrics, for decoration** (parsed since 2026-07-10): AFM gives `UnderlinePosition -100`,
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
**Since 2026-08-26 it THROWS** (`MissingRendererError`), and the message names both causes - an
unregistered element, or two copies of `@jasy/pdf`. The dead guards are gone. Note the corollary: the
registry keys on the EXACT constructor, so a SUBCLASS of a registered element is not registered either
and now throws - deliberate, because silently borrowing the parent's renderer would draw the parent.

**This bit us for real** (2026-08-26, ISSUE-11): `@jasy/nuxt` injects auto-imports into the
CONSUMER's code (`addServerImports({ from: "@jasy/pdf" })`), so under pnpm the consumer's route and
the module's runtime resolved `@jasy/pdf` to two module records. Blank page in `nuxt dev`; `nuxt build`
and the monorepo playground both hid it.

**The rule that follows:** a package whose names you inject into someone else's code must be a
**peer dependency**, or the injector must resolve the path itself and inject that. Exact version pins
answer a different question - they fix VERSIONS, not module IDENTITY.

**Fixed 2026-08-26**, and the mechanism was NOT what it looked like: there was one physical copy on
disk. Nitro resolves the CONSUMER's server code and the module's own runtime separately, so one server
build held two module records. `nitro.alias` on the resolved path pins them together; `@jasy/pdf` and
`@jasy/vue` became peer dependencies of `@jasy/nuxt` so a consumer cannot install a second copy either.
Two things measured along the way that are worth NOT re-testing: `nitro.externals.inline` does not fix
it, and the `browser` field is not involved (the main entry has no browser condition).

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
  build (`tsconfig.json` includes only `src/**`) therefore keeps `dist/` test-free. **1407 tests, green** —
  what the root run covers: core 908, `@jasy/cli` 37, `@jasy/vue` 33, `@jasy/e-invoice` 38. `@jasy/nuxt`
  is excluded from it (`vitest.config.ts`) and runs on its own.
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

## What's built, and the genuine gaps

The big refactors the roadmap set out are **done** (Phases 0-6, shipped as `@jasy/pdf@1.0.0-alpha.1`):

- ✅ **Pagination / fragmentation** — the old "last 15% / rattenschwanz wall" is solved. A pure
  `fragment(maxHeight, width, ctx) → { fitted, remainder }` protocol (`layout/fragmentation.ts`, shared
  `packChildren`): text splits at line boxes, padding/border clone per fragment, flex containers re-pack;
  the page driver loops the remainder into fresh pages, `header`/`footer` repeat. Positions are computed
  DURING fragmentation, not mutated onto shared instances — constraints down once, sizes up once.
- ✅ **One shared line-breaker** (`text/line-breaker.ts`) feeds measure, draw AND fragmentation; the old
  duplicated-wrapping divergence is gone.
- ✅ **One shared line-metrics module** (`text/line-metrics.ts`, 2026-07-10) — the VERTICAL counterpart:
  `lineBoxFor(parts, lineHeight?) → { height, baseline }`. Measure/fragment/draw all call it, so a line's
  height and its baseline are decided in exactly one place. Ascent/descent/lineGap come from the font via
  `FontMetrics.getFontVerticals`: an embedded face answers from its `hhea`, a standard-14 face from its
  **`FontBBox`** — NOT from the AFM's `Ascender`, which is a glyph metric (the height of `b`/`d`/`h`), not a
  line metric. This is what makes an all-caps word sit optically centred, matching Chrome to a third of a
  point. `lineHeight` unset = the font's natural line height (CSS `line-height: normal`); a number = a
  multiplier of the font size. Half-leading splits the slack evenly, Flutter/CSS style.
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
- ✅ **Every string encrypted, and encrypted files can be OPENED** (2026-07-29, branch `fix/encrypt-strings`).
  The old encryption enciphered **streams only**; a form field's `/T` `/V` `/TU`, every bookmark `/Title`,
  link `/URI`, `/Alt` and `/DA` sat in the file in plain text - a leak in RELEASED code, and a
  self-contradiction a conforming reader chokes on. Fixed with ONE choke-point,
  `PDFObjectManager.pdfString()`, mirroring `streamPayload()`: no handler → the escaped literal (output
  byte-identical, 22/22 gallery), a handler → the bytes are registered and `finalizeEncryption` swaps in a
  hex ciphertext. Every emitter routes through it; the escape helpers left dead behind were the proof none
  was missed. **Reading came with it, symmetric by decision**: `PdfDocument.open(bytes, { password })`
  decrypts once, eagerly, so `getObject`, `streamData` and the whole form layer stay synchronous;
  `fillForm` is therefore **async** and takes `{ password }`, and re-enciphers both the new values and the
  strings it carries over. Building it one-way would have shipped two bugs the round-trip caught: `/DA`
  and `/CIDSystemInfo` were still plaintext, and the incremental writer DROPPED `/Encrypt` from the new
  trailer. Errors are named, never generic: no password · wrong password · a revision we do not implement.
- ✅ **Encryption** (2026-06-28, `@jasy/pdf@alpha.4`) — AES-256, V5/R6 (ISO 32000-2, the newest standard).
  `renderToBytes(doc, { encrypt: { userPassword, ownerPassword?, permissions? } })`. Built on **WebCrypto**
  (`crypto/webcrypto.ts`, isomorphic, zero-dep) behind a pluggable **`SecurityHandler` seam**
  (`crypto/security-handler.ts`) — a future algorithm/revision is just a second impl. Streams encrypt at one
  choke-point (`streamPayload`) + a finalize pass (`finalizeEncryption`) writes `/Encrypt` + forces `/ID`;
  `EncryptMetadata false` keeps XMP plaintext. Mutually exclusive with PDF/A (ZUGFeRD throws). `recoverFileKey`
  (validates the password vs `/U`) is the groundwork for a future decrypt/edit path. Proven against poppler.
- ✅ **Color emoji — COLR/CPAL v0 + v1** (2026-07, merged + shipped) — real color emoji
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
  byte-identical. Full conformance needs embedded fonts + a title (same as PDF/A).
- ✅ **Rotate** (2026-07-08) — `Rotated({ angle })` spins a subtree at any angle at PAINT time (stamps,
  watermarks; layout-neutral, siblings do not reflow); `RotatedBox({ turns })` does layout-aware quarter-turns
  (a 90/270 turn swaps w/h, so a vertical label reserves its strip). One IR pair `TransformPush{matrix}` /
  `TransformPop` → `q … cm … Q`; `flipY` conjugates the matrix (`M_pdf = F·M·F`) so producers stay
  coordinate-blind. Known gap: an annotation inside a transform does NOT rotate (see gap 6 below).
- ✅ **letterSpacing** (2026-07-10) — `Text({ letterSpacing })` in points (CSS `letter-spacing`, the PDF
  `Tc` operator), per `span` too, inheritable, negative tightens. Added after EVERY glyph (the last one
  included, like `Tc` and like CSS), so a spaced paragraph still wraps correctly and a spaced run still
  aligns. `Tc` is isolated in a `q/Q` so it cannot leak into the next run; at 0 nothing is emitted
  (byte-identical). Verified against headless Chrome at the time (before kerning shipped): glyph positions
  matched to within the kerning Chrome applied and we did not yet. Introduced **`text/advance.ts`** — the ONE
  canonical run advance (`runAdvance`), the horizontal peer of `line-metrics.ts` and `line-breaker.ts`;
  the line-breaker, `naturalWidth`, the renderer and the skip-ink pen all call it, so measuring and drawing
  can never disagree. `advance = sum(glyph widths) + sum(kerning) + n*letterSpacing` — all three terms are
  wired now (kerning via `TJ` + `GPOS`, on by default; see the font-writer section). Gallery `20-letter-spacing`.
- ✅ **Text decoration** (2026-07-10) — `Text({ underline, strikethrough })`, also per `span` and inheritable
  from `Document`/`DefaultTextStyle`. The stroke sits at the font's `UnderlinePosition` and is
  `UnderlineThickness` thick; a strikethrough crosses at half the `XHeight` (which is where Chrome puts it,
  measured). One `Line` IR node per drawn run, so a wrapped paragraph gets one stroke per LINE and a
  decorated span only spans its own glyphs. A `Link` is NOT underlined by default.
  **`skipInk`** steps the underline around descenders (CSS `text-decoration-skip-ink`) by scanline-filling
  the real glyph outlines (`TTFParser.inkSpansInBand`). Gap widths match Chrome to 1-2 px at 200 dpi
  (`[25, 85, 192, 59, 120]` vs `[24, 85, 190, 58, 120]`). **react-pdf cannot do this at all** (verified: its
  underline runs straight through `g` and `p`). It needs an EMBEDDED font — the standard-14 outlines live in
  the viewer, not in the AFM — and asking for it with a standard font **throws** rather than silently drawing
  a solid line. Gallery `19-text-decoration`; the skipInk specimen is `claude-data/out/decoration/`.
- ✅ **Page-break control — Step 1 (termination guarantee) + Step 2 (`PageBreak`)** (2026-07-11) — the general
  guard first: every physical page in the paginate loop has the FULL body height, so `fitted === null` means the
  region did not shrink even on a whole page → advancing would loop forever → we place it whole (clipped) +
  `reportOverflow` + stop. "A step that shrinks nothing ends the loop" is Flo's rule, replacing Flutter's
  arbitrary N-attempts. Then `PageBreak()`: a zero-size, non-drawing marker; `packChildren` cuts the flow at it
  (everything after → fresh page). Nesting works via a `forceBreak` field on `FragmentResult` that bubbles up +
  `hasForcedBreak()` (recursive), so a break deep in a `Box` carries its later SIBLINGS over too. An INEFFECTIVE
  break (inside a horizontal `Row`, or any non-paginating flow) is ignored — the NORM: measured react-pdf 4.6
  ignores `<View break>` in a `flexDirection:row` (1 page), and react-pdf has no standalone break element at all
  (break is a PROP = break-before). We keep the `PageBreak()` element as a convenience but match the ignore, plus
  ONE `console.warn` at the single choke-point where an orphaned break surfaces (the `PageBreakRenderer` — a
  consumed break never reaches render). A consumed TRAILING break must NOT warn, so the `fits-on-one-page` fast
  paths (Container/Rectangle `return this`, driver `kind:"whole"`) gate on `!forceBreak`. Gallery byte-identical
  (inert without a break). **Step 2b — `breakBefore`/`breakAfter` props** (the CSS/react-pdf NORM api: break is a
  prop, not an element) on `Box`/`Column`/`Row`: `breaksBefore()`/`breaksAfter()` on the base element, read by
  the parent `packChildren` at the child boundary (cut before, ignored at region top per CSS; cut after a
  whole-placed child). A shared `childrenForceBreak()` helper folds them into `hasForcedBreak` so a break-before
  nested deep in a box bubbles up. Fragment clones drop the flags (continuations). Gallery `21-page-breaks`.
  **Step 3 — `keepTogether`** (CSS `break-inside: avoid`): `keepTogether([...])` factory + prop on
  `Box`/`Column`/`Row`. A layout-TRANSPARENT wrapper (`KeepTogetherElement`, like `StructGroup`) whose
  `fragment()` (1) keeps whole if it fits, (2) VETOES the split and defers the group whole to a fresh page if it
  would fit there, (3) DEGRADES (splits) if it is taller than a whole page so pagination terminates. Needs the
  full page body height, threaded as `LayoutContext.pageBodyHeight`. Inner keepTogethers survive an outer
  degrade (re-evaluated when the child splits). A forced break inside WINS and WARNs once. The prop is wrapper
  sugar (`maybeKeepTogether`), so `Box`/`Column`/`Row` now return `PDFElement`. Gallery `22-keep-together`.
  **Page-break control is COMPLETE** (guard + PageBreak + breakBefore/After + keepTogether).
- ✅ **Navigation** (2026-07-09, `@jasy/pdf@alpha.6`) — `Link({ href })` (external URL) or `Link({ to })`
  (internal jump); `href`/`to` on a `span` links just that run (one /Rect per wrapped line); `Anchor({ name })`
  is the jump target, resolved through the catalog `/Names /Dests` name tree, so a link may point at a page
  that has not been rendered yet. `Bookmark({ title, level })` builds the nested `/Outlines` sidebar tree.
  All three are layout-transparent wrappers emitting side-channel IR nodes that draw NOTHING (`serializeNode`
  returns `""`); `PageRenderer` peels them into `/Annots`, `PDFRenderer` into the catalog. `/EmbeddedFiles`
  (ZUGFeRD) and `/Dests` share ONE `/Names` dict. Off = byte-identical.
- ✅ **Page numbers** (2026-07-09) — the page driver now PAGINATES the whole document, THEN draws, so the
  total exists before page 1 is painted. `PageBuilder(({ pageNumber, pageCount, pageSize }) => element)` is the
  primitive and works ANYWHERE (header, footer, body, a table cell); `PageNumber({ offset })` / `PageCount()`
  are one-line sugar. Caveats, both from the same chicken-and-egg: dynamic BODY content reserves its box from a
  provisional "1 of 1" build, and a conditional header may SHRINK on later pages but never GROW.
- ✅ **The `Spacer` bug** (2026-07-09, GitHub #10) — a flex child on an UNBOUNDED main axis resolved to
  `Infinity`, which became the offset of every following sibling and was written into the content stream
  verbatim (`56.000 -Infinity Td`). Viewers discard the stream from there, so siblings AND the footer silently
  vanished. Now: flex collapses to `0` on an unbounded axis; `PdfBackend.assertFinite` REFUSES to serialize a
  non-finite number (it checks numbers, not text, so `Text("Infinity")` still renders); and a stack holding a
  flex child ASKS its parent for a bounded main axis (`PDFElement.needsBoundedMain`, propagated recursively
  through `Column`/`Row`/`Box`). So `Spacer()` finally pushes to the bottom in a nested `Column` and in a sized
  `Box` — it never worked there before.
- ✅ **Performance, ~4.8x** (2026-07-09, GitHub #12) — the hot path built STRING KEYS inside per-character
  lookups. `resolveCustomStyle` early-outs when no custom font is registered; `customFonts` became
  `Map<family, Map<style, TTFParser>>` (one map walk, not three key builds); `AFMParser.kerningPairs` is nested
  too. Standard-14: 590 → 124 ms. Custom TTF: 778 → 119 ms (react-pdf 4.5.1: 181 ms on the same document).
  Output byte-identical throughout, veraPDF still PDF/A-3b compliant. Harness: `node claude-data/bench.mjs`.

- ✅ **AcroForm — create AND fill** (2026-07, branch `feat/forms` then `feat/forms-edit`, NOT yet released).
  **Creating**: `TextField`, `Checkbox`, `Radio`/`RadioGroup`, `Dropdown`/`Select`, `ListBox`, `PushButton`,
  `SignatureField` (`api/forms.ts`) — react-pdf parity plus Signature. A field is a layout element reserving a
  rect and emitting a **widget annotation** through the SAME side-channel path as `Link`/`Anchor`/`Bookmark`;
  the shared spine is `FormFieldSpec` (`forms/field.ts`), appearances are baked in `forms/appearance.ts`
  (opt out with `renderToBytes(doc, { fieldAppearances: false })`). Field text is deliberately UNKERNED -
  viewers do not kern field text, and a baked appearance must match what the viewer redraws.
  **Filling an existing PDF**: `@jasy/pdf/edit` (own entry point, `src/lib/edit/`, lazily loaded so a
  generate-only bundle never ships the parser). `readAcroForm(doc)` → fields; `fillForm(bytes, { name: "Ada",
agree: true })` → declarative values, not object mutation. Save is an **incremental update**: original bytes
  verbatim, changed objects appended, new xref chained by `/Prev` — giving the checkable invariant **the
  original file is a literal PREFIX of the output**. The form is a CONTRACT: unknown name, wrong type for the
  kind, value past `/MaxLen` (inherited like `/FT`), choice outside `/Opt`, read-only, signature, push button,
  ENCRYPTED input — each a named error, never a silent no-op. Reader parts: `lexer.ts` (byte parser; CR/LF/CRLF
  in a literal all mean one LF), `document.ts` (xref table AND xref stream, `/Prev` chains, object streams,
  PNG predictor, scan-rebuild fallback), `acroform-reader.ts` (hierarchical dotted names, `/FT`+`/Ff`+`/MaxLen`
  inheritance, field-vs-widget detection, button value normalisation). Tested against a FIVE-producer corpus
  (`tests/fixtures/forms/`: jasy, pdf-lib ×2, PDFKit, react-pdf) plus a real IRS W-9 (XFA hybrid → warns).
  **The bug worth remembering**: a filled field showed nothing until clicked. Cause was NOT lazy viewers -
  producers that DRAW their fields (jasy, pdf-lib) leave a stale picture of the old value; we wrote a new `/V`
  and kept the old drawing, a self-contradicting document. Fix: drop `/AP` for `Tx`/`Ch` on fill; a BUTTON's
  `/AP` holds its on/off STATES and is kept, only `/AS` moves.
  **Flatten + the fill options** (2026-07-31): `flattenForm(bytes, { fields })` stamps a field's appearance
  onto the page and drops the widget, and `fillForm(bytes, values, { flatten: true })` does both in ONE
  incremental update. The trap that pass had to solve: flatten reads the picture a widget shows out of the
  DOCUMENT, but mid-pass the new one is only in the WRITER - so a filled-and-flattened form would freeze the
  value from BEFORE the fill. Both widget kinds go stale for different reasons (a text field's `/AP` is
  replaced; a button's `/AP` keeps every state and only `/AS` moves), hence `FreshAppearances`. Two option
  combinations are refused by name: `fieldAppearances` + `needAppearances` both false (nobody draws the
  value), and `flatten` with `fieldAppearances: false` (nothing to freeze).

- ✅ **The layout knobs** (2026-08-01) — `aspectRatio`, `minWidth`/`maxWidth`/`minHeight`/`maxHeight` (points
  or a percentage), `%` on padding/margin, `alignSelf`, and a **per-corner** `radius`. One shared resolver
  `resolveSize` (`layout/box-constraints.ts`) serves Box · Column · Row · Image, and the ORDER is the
  contract, following CSS: relative sizing → the ratio fills whichever axis was left open → min/max clamp.
  So an explicit bound beats the ratio, the way `min-height` beats `aspect-ratio` in a browser.
  Two things that are easy to get wrong and are pinned by tests: min/max come back as **narrowed
  CONSTRAINTS**, not a clamped number (an axis with no explicit size still has to obey them), but the
  **fill-vs-shrink-wrap DECISION** stays on the constraints we were HANDED - a `max-width` caps a box, it
  never makes one grow. And a percentage resolves against the OFFERED box, then gets clamped: `width: "50%"`
  with `maxWidth: 100` in a 400pt region is 200 capped to 100, not 50% of 100.
  `%` insets follow the CSS quirk on purpose: **a percentage resolves against the WIDTH on all four sides**,
  top and bottom included (`layout/insets.ts`; Yoga does the same, so react-pdf agrees). The per-corner
  radius scales two radii sharing an edge down TOGETHER when they would overlap, which react-pdf does not -
  it clamps each corner alone. The `overflow: hidden` clip follows the same four corners.
- ✅ **Gradients** (2026-08-01) — `Box({ bg: linearGradient(…) })` / `radialGradient(…)`, written
  BOX-RELATIVE (an angle and stops) and resolved against the box by the renderer, which is the first place
  its geometry is known (`api/gradient.ts` `resolveGradient`). Angles follow CSS: 0 points up, clockwise.
  Cheap because the backend already emitted axial and radial shadings for COLR v1 colour emoji - only the
  public prop and the plumbing were missing. **PDF has no gradient fill colour**: `sh` floods the current
  clip, so a gradient box becomes the clip, the shading is painted inside it, and a border is stroked
  afterwards on its own. A solid colour keeps the plain `rg`/`f` operators, so old output stays byte-identical.
  `flipY` flips the gradient's page-space anchors WITH the rect, exactly as it already did for `Path`.
- ✅ **The reader refuses a zip bomb** (2026-07-31, ISSUE-8) — `inflateBounded` (`edit/inflate.ts`) plus
  `maxStreamSize` on `PdfDocument.load`/`open`, `fillForm` and `flattenForm` (default 64 MB), throwing a
  named `PdfStreamTooLargeError`. Worth remembering because the obvious fix is wrong: **fflate does NOT
  throw on an over-long inflate, it TRUNCATES silently**, so `unzlibSync(data, { out })` would have replaced
  an OOM with quiet data corruption. The working shape streams the input in slices and checks the total as
  it grows. It costs nothing because a stream too small to reach the ceiling at DEFLATE's maximum expansion
  (1032:1) skips the check - which is nearly every stream in a real PDF.

- ✅ **Fonts from a URL, and WOFF1** (2026-08-01) — `await doc.addFontFromUrl("Inter", url)`, one file or
  a styled family (fetched in parallel). It resolves AT REGISTRATION, exactly as `addFont` reads a path
  there and then, so a dead link fails on the line that asked for the font rather than inside a later
  render. Guarded like any other network read: a 15 s timeout, a 32 MB ceiling enforced WHILE the body
  arrives (`Content-Length` is only a hint), and every failure wrapped as `FontUrlError`.
  It also names what a file actually IS - `TTFParser` never looks at the sfnt signature, so a 404 HTML
  page used to fail deep inside as `missing required table "head"`.
  **WOFF1** is unpacked at the ONE point every font path meets, `PDFObjectManager.registerCustomFont`'s
  `new TTFParser(...)` - so a file, raw bytes, a URL and a browser upload all get it, and nothing
  downstream learns a second container format (`utils/woff.ts`). A WOFF is not a different font, it is
  the same sfnt tables optionally zlib-compressed behind a 44-byte header. Verified by wrapping a real
  Lato `.ttf` into a WOFF and rendering both: identical glyph output, identical subset size (41,540 B),
  identical PDF. `utils/inflate.ts` moved out of `edit/` for this - the generate path must not import
  from the edit path, and the zip-bomb ceiling now guards a WOFF table too.
- ✅ **Section page numbers** (2026-08-01) — `subPageNumber` / `subPageTotalPages` on `PageInfo`, plus
  `SubPageNumber()` / `SubPageCount()` sugar. The count WITHIN one logical `Page` element, beside the
  document-wide one: an invoice plus its attachment can foot "Attachment, page 1 of 2" next to "sheet 3
  of 4". Nearly free because Pass A of the page driver already walks one logical page at a time - the
  length of each run IS that section's total. The provisional `PageInfo` used during pagination carries
  them too, or a `PageBuilder` would measure against a half-filled object.
- ✅ **Full flexbox** (2026-08-01) — `wrap` + `alignContent`, `flexShrink`, `flexBasis` (points or `%`),
  `order`, `reverse` on `Row`/`Column`. This closes the last react-pdf parity gap in layout (Yoga gives
  them that set for free). `FlexLayoutHelper.layout()` now dispatches: the untouched single-line engine
  is `layoutLine()`, and `layoutWrapped()` splits into lines, measures each, then places the BLOCK of
  lines by `alignContent`. Two defaults deviate from CSS ON PURPOSE — `flexShrink` is **0** (CSS says 1)
  so no existing layout moves, and `alignContent` is `start`. All of it is off by default, which is why
  the 30 gallery cases before it stayed byte-identical.
  **The trap that cost a real bug:** a line's `%` children resolve against **the line minus its gaps**
  (our documented relative-sizing rule, so N columns at (100/N)% fit exactly). The wrap pass has to use
  the SAME base — it first measured against the full line, making each child a few points too wide, and
  three chips at 33% wrapped the third for no reason. A line cannot be measured child by child: whether
  a child fits depends on how many gaps the line ends up with, so `lineExtent()` re-costs the whole
  candidate membership. Pinned by `tests/unit/api/flex-real-content.test.ts`, which is deliberately NOT
  plain boxes — a `Table`, a wrapping paragraph and a nested `Column` re-measure differently when an
  item is made narrower, and that is where a flex engine actually breaks. Gallery `31-flexbox`.
- ✅ **Byte-stable output, UNENCRYPTED** (verified 2026-08-01) — the same document rendered twice is
  byte-identical, PDF/A and a ZUGFeRD invoice included, across separate processes. Nothing on that path
  reads the clock or a random source; we write no `/CreationDate`/`/ModDate`; and the trailer `/ID` PDF/A
  requires is `contentId()`, an MD5 over the objects. **`renderToBytes(doc, { encrypt })` is excluded and
  cannot be otherwise**: R6 draws random salts and a random file key, and every stream gets a fresh IV, so
  two renders of the same document differ by design (measured). Encryption and PDF/A are mutually
  exclusive anyway, so the archival case never meets it. This is what makes an archived or audited e-invoice re-derivable and hashable years later.
  `packages/e-invoice/tests/determinism.test.ts` pins it, with a counter-test that a changed invoice
  number DOES change the bytes so the check cannot pass vacuously. The honest limit: byte-stable per
  library VERSION — a bump may legitimately change output, as turning kerning on did.

- ✅ **Bidirectional text - ORDERING** (2026-08-02) — Hebrew, and mixed Hebrew/Latin/digits, come out in
  the order a reader expects. `Text({ direction: "rtl" })`, inheritable from `Document`/`DefaultTextStyle`
  like every other text style. The whole seam is **`src/lib/text/bidi.ts`** (`visualRunsOf`): one LINE of
  pieces in, the runs to DRAW out, left to right. UAX #9 itself comes from `bidi-js` — the same library
  react-pdf uses — and **nothing outside that file knows it exists**, so replacing it with our own is a
  one-file change (a named `todo.md` item; the dep is unmaintained since 2023 and ships no types, hence
  `src/types/bidi-js.d.ts`).
  Why it was not a rewrite: bidi runs AFTER line breaking, per finished line, and `pushLine` already
  emitted a line as runs with their own absolute x — so reordering is a permutation plus recomputed x.
  Decorations and links follow for free, since they hang off the same x/advance.
  Three things that are easy to get wrong and are pinned by tests: the algorithm runs over the **whole
  line across span boundaries** (each run remembers its span, so it keeps that font/colour/link) — doing
  it per span would leave a Hebrew span in source order; a **surrogate pair** is two code units at one
  level, so a naive reversal splits an emoji in Hebrew text into two broken halves; and the fast path is
  a strict **pass-through** (same pieces, empty ones included) so every existing document stays
  byte-identical — 30/30 gallery unchanged.
  `HorizontalAlignment.start` is new and is now the DEFAULT: CSS `text-align: start`, resolved to left in
  `ltr` and right in `rtl` at the ONE place alignment is consumed. That is what makes an rtl paragraph
  begin on the right without anyone asking.
  **Verified against headless Chrome AND react-pdf 4.5.1**, not against our own reasoning: on Hebrew we
  and react-pdf are identical character for character, and both sit within 1 pt of Chrome — a Latin
  sentence with Hebrew in it, an rtl base line, digits inside rtl text, and bracket **mirroring**. Demo
  `claude-data/out/bidi/bidi.pdf` (`claude-data/gallery/bidi-demo.ts`).
  The react-pdf run is what caught the one real bug: `getMirroredCharactersMap` wants the LEVEL ARRAY
  while bidi-js's README passes the result object, so it returned an empty map and no bracket was ever
  mirrored — and our own test was vacuously green because it asserted the broken order. Known gap, in
  `todo.md`: we SUBSTITUTE the mirrored character (as react-pdf does) where Chrome keeps the original and
  mirrors the glyph, so extracted text has swapped brackets.
  Arabic ordering landed here; the JOINING that makes it readable came right after — see the shaping
  entry below.

- ✅ **Arabic SHAPING (OpenType GSUB)** (2026-08-02) — letters join and lam-alef collapses into one
  glyph, read from the font's own `GSUB`. No presentation-form (U+FExx) fallback: that route is a dead
  end, since modern Arabic faces omit the block and rely on `GSUB` alone.
  Three modules, each with one job. **`utils/gsub.ts`** reads script → langsys → feature → lookup and
  runs the types that carry Arabic: **1** (one glyph becomes another — that IS the joining), **4**
  (several collapse into one — lam-alef) and **7** (the extension wrapper big fonts hide the rest
  behind). Any other type is REPORTED, never guessed at. **`text/arabic.ts`** holds the Unicode 17.0.0
  joining types (187 ranges, binary-searched); transparent marks are folded in from the character
  database because `ArabicShaping.txt` lists almost none of them. **`text/shape.ts`** is the only place
  the two meet.
  **The rule that cost the most: shaping sees the LOGICAL text, and its GLYPHS are reversed after.** A
  letter's form comes from its neighbours, and bidi has already swapped them — shaping the drawn text
  gave a word 42.5 pt where it should be 34.4, and measuring and drawing were wrong TOGETHER, so
  nothing looked inconsistent. `VisualRun.logical` exists for exactly this.
  Two more that are easy to miss: **kerning is off for a shaped run** (its pairs are keyed by unshaped
  glyphs, and the `TJ` path would re-shape each chunk in isolation, turning every letter isolated), and
  **`letterSpacing` counts DRAWN glyphs**, since a ligature is one glyph for two code points.
  `TextRun.glyphs` is the new IR field — a shaped run cannot be expressed as a string. `ToUnicode` maps
  each shaped glyph back to the letters that were WRITTEN (recorded at shaping time, the only moment
  both are known), so copied text is real Arabic and not presentation forms.
  **Verified against headless Chrome AND react-pdf 4.5.1**: identical word widths to 0.1 pt and
  identical extracted text. Demo `claude-data/out/bidi/bidi.pdf`.
  Not built, none blocking: lookup type **6** (chained context) and **GPOS mark positioning** — measured
  2026-08-02, **react-pdf does neither either**: on vocalised Arabic our ink box and its are identical to
  the pixel and only Chrome differs, by 3 px on one mark. Also the discretionary `liga` (Latin, nothing
  to do with RTL) and scripts beyond the Arabic family. All in `todo.md`.

- ✅ **Justified text** (2026-08-02) — `Text({ align: "justify" })`. The enum member is
  `HorizontalAlignment.justify`; it was called `block` and did nothing, and was renamed while it still
  had no users. A line's slack is spread over its spaces by MOVING THE PEN, one run per word: the `Tw`
  operator reaches only the single byte 32, so an embedded Identity-H font could never be stretched that
  way. A shaped (Arabic) piece is never split, so it keeps natural spacing.
  The line may also be **SQUEEZED** to keep one more word on it, up to `MAX_SPACE_SHRINK` (a quarter of
  a space, `text/line-breaker.ts`). Our breaker is GREEDY and spends the whole allowance whenever it
  saves a line, so the limit is the tightest word space still worth reading rather than TeX's third.
  The allowance is threaded into BOTH passes (`TextElement.spaceShrink`), or a paragraph would be
  measured at one line count and drawn at another.
  The last line is never STRETCHED — the print and CSS rule — but it IS squeezed when the breaker
  packed it that way, or it would be drawn out of its box. That case only surfaced under mutation
  testing.
  Verified against react-pdf: lines 2-6 of the same paragraph are identical, `print` lands on the same
  line, and both fill exactly 222.0 pt. Line 1 still differs by one word because react-pdf spreads its
  squeeze over the CHARACTERS as well as the spaces.
- ✅ **Line-breaker fix: the joining space** (2026-08-02) — the fit test asked `currentWidth +
wordWidth > maxWidth` and forgot the SPACE that would join the word. It went unseen on the first line,
  where the paragraph's first word added a space too many and cancelled the error out; after a break
  `currentWidth` is the bare word, so every following test was short by one space and the line could
  overrun its box by that much. Found by comparing a justified paragraph with react-pdf — a glyph
  visibly hanging past the edge. **This one is NOT byte-neutral**: four gallery cases
  (`07-header-footer`, `12-line-height`, `17-page-numbers`, `19-text-decoration`) now break a word
  earlier, because they were overflowing before.

- ✅ **`singleLineWidth` — the box and the breaker agree to the last bit** (2026-08-02) — a `Text` in a
  `Row` is sized by its natural single-line width, and the breaker then decides whether that line fits.
  Both sum the same words and spaces, but they GROUPED the additions differently — `(word + space)` per
  word versus `word + (space + word)` — and floating-point addition is not associative. The box came out
  one bit narrower than the line it was made for, so the text wrapped inside it. A gallery footer split
  onto two lines from exactly that.
  One exported function in `text/line-breaker.ts` now owns the sum, and the breaker's own fit test uses
  the identical expression for the test AND for the running total. Pinned by
  `tests/unit/text/single-line-width.test.ts`, whose metrics are deliberately non-binary widths so the
  grouping actually shows.
  The SEGMENT breaker had the same disease twice over (found by review): its reported `line.width`
  counted a space for EVERY word, the last one included, so a right-aligned span line sat 16 pt short of
  its box — and its fit test forgot the joining space, exactly as the string one had. Both now follow
  the same rule, and a space joins words only INSIDE a segment, since `span("a") + span("b")` draws
  `ab` with nothing between.

- ✅ **The four CSS text properties react-pdf had and we did not** (2026-08-02) — `textTransform`,
  `wordSpacing`, `textIndent` (all inheritable, `Document` → `DefaultTextStyle` → `Text`) and
  `verticalAlign` on a `span` (super/sub). Each was measured against `@react-pdf/stylesheet` first, not
  recalled.
  Two of them are only correct because they reach BOTH passes. **`textTransform`** is applied at one
  choke point, `TextElement.display()`, which every measure, break and draw reads - recasing at draw
  time alone would measure `world` and draw `WORLD`. **`wordSpacing`** is a per-gap advance that rides
  the same mechanism as the justification slack (one run per word), because `Tw` reaches only the single
  byte 32 and would miss every embedded font; it is counted in `singleLineWidth` too, or a `Text` in a
  `Row` would get a box too narrow for its own spaced text.
  **`textIndent`** takes its room out of the FIRST line only - the breaker gets `maxWidth - indent` for
  it, and alignment measures against that same reduced room. **`verticalAlign`** shifts one run's
  baseline (super +1/3 em, sub -1/5 em) and deliberately does NOT resize it: a browser's `<sup>` is
  small because of its default stylesheet, not because of `vertical-align`.
  The breaker's growing tail of positional arguments became one `LineOptions` bag ({ wordSpacing,
  indent, shrink }).

- ✅ **Font fallback stack** (2026-08-02) — `Text({ font: ["Inter", "NotoSansCJK"] })`: each code point
  is drawn by the first family in the list that has a glyph for it, so mixed-script text works without
  splitting it by hand. Inheritable like every other text style; a single name behaves exactly as before.
  The decision that made it small: the fallback resolves the content into **spans**, one per family
  (`text/font-fallback.ts` → `splitByFont`). That is the shape a styled `span` already has, so breaking,
  bidi, shaping and drawing all handle it with no new code — instead of a second per-code-point
  mechanism beside the existing ones.
  Coverage is `FontMetrics.hasGlyph`: an embedded face answers from its `cmap`, a standard-14 one from
  what Windows-1252 encodes (`isWindows1252`), which is exactly what its `/Widths` array indexes.
  Two things that had to be right: the split happens in the LAYOUT pass and is REMEMBERED
  (`TextElement.resolved`), because the render pass has no metrics and would otherwise draw everything
  in the first family — measured ≠ drawn again; and it iterates CODE POINTS, or a BMP-only family would
  keep both halves of an astral character and draw it from a font that does not have it.
  A code point no family in the stack has stays with the first one and shows its `.notdef`, as a browser
  does — dropping it would make the text read differently than it was written.

- ✅ **Invoicing period, BG-14 + BG-26** (2026-08-02, `@jasy/e-invoice`) — `invoice.period` and
  `line.period` (`{ start, end }`) emit `ram:BillingSpecifiedPeriod` in CII and `cac:InvoicePeriod` in
  UBL, at document AND line level. Why it matters: §14 Abs. 4 Nr. 6 UStG wants a delivery DATE or a
  PERIOD, and for a recurring monthly service the period is the truthful one. The XRechnung rule says
  it word for word — delivery date OR document period OR a period on **every** line — so the
  pre-check (`xrechnungProblems`) enforces exactly that, `every` and not `some`, and also refuses a
  period that ends before it starts.
  The position in the XSD sequence is load-bearing (after the trade taxes, before the allowances);
  proved by rendering a real invoice and running it through our own KoSIT schematron, not by reading
  the spec twice. Found while auditing four rejected SumUp invoices for Flo: none carried BT-72 or
  BG-14, the period was free text in the item description only.

- ✅ **Text that cannot be drawn - the invisible class** (2026-08-30). A character with no glyph is
  still ENCODED and DRAWN: it comes out as the font's `.notdef` box, and veraPDF rejects the file for
  referencing it (ISO 19005-3, 6.2.11.8). Found on a real invoice whose service description carried its
  own line breaks - the first string that reached jasy from OUTSIDE instead of being composed line by
  line in our own code. Two separate faults, one symptom:
  - **`\n` is a HARD line break** now (`text/whitespace.ts` + both breakers). It breaks even where there
    is room, because it is an instruction, not wrapping. `\r\n`, a lone `\r`, `\n\r` and U+2028/U+2029
    fold into it; a tab becomes a space; C0/C1, U+200B and U+FEFF are dropped. U+200C/D and U+200E/F are
    KEPT - they drive Arabic shaping and bidi, and removing them would silently change correct text.
    Normalised once in the `TextElement` constructor, the one place every text enters.
  - **A code point no font can draw is removed and REPORTED** (`text/glyph-coverage.ts`). The check is
    DYNAMIC against the resolved font - which characters are missing is a property of the FONT, not of
    Unicode (`@jasy/e-invoice` embeds Liberation, whose gaps look arbitrary: "→" draws, "⇒" does not).
    A plain equivalent is substituted where one means the same, because dropping U+2011 would turn
    `E-Rechnung` into `ERechnung`. Everything else is dropped and handed back: `renderToBytes` gained
    `onMissingGlyphs`, `renderZugferd` returns `droppedCharacters`. Deliberately no policy option - a
    missing tick must never stop an invoice being produced, and a server log is not a report. Colour
    emoji is exempt (`rendersAsEmoji`): it is missing from the text font by design.
  - This REVERSED a documented decision: an undrawable code point used to stay and show `.notdef`,
    "as a browser does". PDF/A forbids it, so completeness now outranks browser parity.

- ✅ **A word that does not fit** (2026-08-30, `text/word-splitting.ts`). It used to stay on its line and
  draw over its neighbour - on an invoice, a §14 UStG mandatory field painted across its own label.
  Two layers, stacked as CSS stacks them, **both off by default** (so a too-wide word still overflows,
  as in CSS, and every existing document is byte-identical):
  - **`Text({ breakWord })`** splits where the box ends, no hyphen. The floor - it is what an e-mail, an
    IBAN or an invoice number needs, having no valid hyphenation point anywhere.
  - **`Text({ hyphenate })`** splits at a valid point and draws the hyphen. **A HOOK, not bundled data**:
    German patterns alone are 732 KB, against the character of a library that sells on "no headless
    browser, no JVM". `hyphen` (ISC) returns a word with soft hyphens, so the adapter is one line -
    documented in `docs/api-design.md` 6c and EXECUTED by
    `tests/unit/text/hyphenation-integration.test.ts`, because a documented integration nobody runs
    rots. **No `@jasy/hyphenation` package is planned** (reasoning in `todo.md`).
  - The default is a POSITION, not a gap: _we do not hyphenate until you name the language._ react-pdf
    hyphenates with no configuration using the patterns it ships - German split by English rules, in the
    market we care about.
  - Both are read per `Text`, not per `span` - known deviation from CSS, `todo.md` ISSUE-13.
  - The two traps this feature walked into, both caught by tests written afterwards: the SEGMENT breaker
    appended the first piece to the line it was already filling (a 50pt box got an 80pt line, and
    REPORTED 50), and the renderer built its `SegmentDefaults` without `splitting`, so spans never split
    at all. Same shape as the older bugs - one path right, the other wrong; measured ≠ drawn.

- ✅ **Latin ligatures, and kerning for a shaped run** (2026-08-30). `fi`, `fl`, `ffi` become one glyph,
  read from the font's GSUB. **ON by default**, like kerning - the font's designer drew them, CSS and
  every other renderer apply them, and nobody should need the word to get text set properly. An
  inheritable text style, so `ligatures: false` opts out on a `Text`, a `DefaultTextStyle` subtree or the
  whole `Document`. Embedded fonts only (the standard-14 have no GSUB). Internally the run carries a
  FEATURE LIST, not a boolean - that is the seam a general `fontFeatures` would use; react-pdf exposes
  `fontFeatureSettings`, which we do not copy because our GSUB reader only executes lookup types 1, 4
  and 7 and promising the rest would be a promise we cannot keep.
  - **It needed kerning for shaped runs first**, which did not exist: `getKernPairs` returned `[]` on
    sight of a shaped run, because the pairs were keyed by unshaped glyphs and the `TJ` operand was
    built from TEXT. Shipping `liga` on top of that would have traded every kern for a few ligatures -
    DejaVu kerns `To` by **-170**. Now `getGlyphKernPairs` kerns the drawn glyphs (`getKerning` is glyph-
    keyed anyway) and `PdfBackend.kernedArray` is generic over its unit, so ONE chunking serves
    characters and glyph ids. Arabic gains the same, closing a `todo.md` gap.
  - **Four bugs on the way, all the same shape - measured ≠ drawn.** The renderer shaped at DRAW time
    with the default setting; the backend asked `getKernPairs` without the run's setting, so it shaped
    internally and returned 11 pairs for 13 characters; `kernedArray` walks the GAPS, so a short list
    silently dropped the last unit ("Verpflichtung" lost its g); and `encodeCustomText` shaped on its
    own although the renderer had already decided. The unit tests were green through all of it - only
    the rendered PDF showed it. `kernedArray` now throws on a length mismatch.

Genuine remaining gaps / deferred:

1. **Absolute positioning — Stages 1+2 built** (2026-06-21). CSS-style: `Box({ relative: true })` is a
   positioning frame (the page is one too); `Positioned({ top,left,right,bottom }, child)` is out-of-flow
   and anchors to the nearest frame (negative offsets poke out); `Box({ overflow: "hidden" })` crops its
   children to the rounded box (an image in one is round-cropped for free). Tests + gallery `10-positioning`.
   The page's frame is its **content box** — built in `PageElement.calculateLayout` BEFORE `layoutPageBands`
   and threaded into header, footer and body alike (`pageFrame(config)`), so `Positioned` means the same
   thing in all three and `bottom: 0` is the foot of the page, not the top of the footer. That is what makes
   **watermarks / draft stamps** work: a `Positioned` in a band repeats on every page and takes no space in
   it (gallery `18-watermark`; this is react-pdf's `fixed`). With no frame at all a `Positioned` now THROWS
   — it used to leave its child at (0,0) and silently draw it in the page corner (ISSUE-4).
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
5. Font gaps: TTF / TrueType-flavoured OTF **and WOFF1** are parsed; OTF/CFF and **WOFF2** are not.
   WOFF2 needs Brotli (which `fflate` does not do) and additionally TRANSFORMS `glyf`/`loca` rather than
   merely deflating them - a different piece of work, not a bigger version of WOFF1. (TrueType kerning is
   DONE - `kern` table + GPOS, on by default since 2026-07-11; this line used to claim otherwise.)
   Bold/italic resolve via registered family variants with a clean fallback to `normal` (no faux styles).
   Color-emoji deferred (none blocking): COLR v1 **rotate/skew** transforms (24-31 —
   Noto doesn't use them; not built without a test font), variable-font paint variants, **sweep** gradient,
   gradient `repeat`/`reflect` extend (drawn as `pad`), and **CFF** / **sbix**+**CBDT** bitmap color fonts
   (so Apple Color Emoji and the bitmap Noto build are unsupported — only glyf-outline COLR fonts render).
6. **A transform does not carry its side channels** (`todo.md` ISSUE-2, priority LOW). Everything a `Rotated`
   subtree DRAWS rotates — text, custom fonts, colour-emoji `Path`s, images, rects, borders, the
   `overflow: hidden` clip, a whole `Table` (all measured). What does NOT rotate is `Link`, `Anchor` and
   `Outline`: they are page `/Annots` and catalog entries, and never see the content-stream `cm` matrix. A
   rotated _clickable_ link therefore keeps an axis-aligned hit area at its un-rotated position. **react-pdf is
   not better here** — it transforms only the rect's two diagonal corners, so its hit area lands in the WRONG
   place (measured: 152.3 × 96.8 pt where the true AABB is 155.56 × 155.56), and it emits no `/QuadPoints` at
   all. The fix (a matrix stack at the `flipY` seam → `/QuadPoints` + a correct AABB `/Rect`) would make us the
   only one who gets it right; it is a corner case, hence LOW.
7. **Encryption reads more than it writes, on purpose.** We WRITE only AES-256 **R6** (ISO 32000-2). We
   OPEN R6 and R5 (`crypto/security-handler.ts`) plus R4 / R3 / R2 (`crypto/legacy-handler.ts`, with RC4
   written out by hand - WebCrypto has none). Reading old schemes is a service to files that already
   exist; writing one would hand a user protection known to be broken, so `StandardLegacy.encrypt`
   throws. Measured while building the foreign corpus (`tests/fixtures/encrypted/`): **PDFKit and
   react-pdf emit 40-bit RC4 by DEFAULT** and cannot emit R6 at all (`pdfVersion: "1.7ext3"` gets you
   R5), and Ghostscript 10.06 refuses anything past R3 - which is why "R6 only" had silently meant "our
   own files only". Remaining gap: **XMP metadata stays unencrypted** (`/EncryptMetadata false`, the
   industry norm so indexers can read it), so in accessible mode the document TITLE is readable without
   the password. A switch for people who want everything hidden is not built.
8. **The test tree is not type-checked** (`todo.md` ISSUE-6, MEDIUM). `tsconfig.json` compiles only `src/**`
   and CI runs vitest, never tsc over `tests/**`; `tsc --noEmit -p tsconfig.test.json` reports 384 errors.
   Dominant cause: tests import without the `.ts` extension, which `nodenext` rejects — the module then
   resolves to `any`, so a REAL type error in a test cannot be seen. `tests/unit/edit/` is already fixed
   (extensions added; the guards in `edit/objects.ts` widened to `PdfObject | undefined`, since they are
   nearly always applied to a lookup that may find nothing), as are the `support/metrics` imports. The
   rest are not; the convention above now documents the extension, so new tests stop adding to the pile.

## Roadmap

The authoritative plan + ground rules live in **`todo.md`** (gitignored, repo root). Read it before
starting work. Working agreement: **phase by phase, Flo approves each gate, Claude never commits/pushes
unprompted, comments English + sensible, don't break the font math.**

Status: **LAUNCHED 2026-06-27**, still shipping alpha increments (no beta/rc/stable until the feature set is
complete — see `todo.md`). All five packages live on npm; **as of 2026-08-30: `@jasy/pdf`@alpha.12,
`@jasy/e-invoice`@alpha.13, `@jasy/vue`@alpha.11, `@jasy/cli`@alpha.10, `@jasy/nuxt`@alpha.9**.

**The release cascade is short now** (2026-08-30). `@jasy/vue`, `@jasy/e-invoice` and `@jasy/cli` depend
on their siblings by RANGE (`workspace:^` → `^1.0.0-alpha.N`, which matches later alphas) instead of the
exact pin `workspace:*` produced, and `@jasy/pdf` is a **peer** dependency of `@jasy/vue` as it already
was of `@jasy/nuxt`. So a patch to the engine needs ONE release, not five - the others pull it on the
user's next install. The peer part is not convenience: it is what stops a consumer ending up with two
copies of the engine, which is the failure that made a Nuxt route render a blank page (ISSUE-11). Repo public + locked, full CI + changelog +
bots in place (see Repo facts). The engine is **feature-complete for the alpha** — inheritance, `onOverflow`,
custom formats, the line-breaker fixes; **1407 tests green** (the root run, i.e. everything but
`@jasy/nuxt`). The **landing**
(`~/projects/jasy-landing` → **jasy.dev**) is built: showroom (12 cards), validator, docs, a home-page
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
media queries are meaningless for a fixed-size PDF). **✅ Relative/percentage sizing DONE (2026-07-05)**:
`width`/`height` as `"50%"`/pt on Box/Column/Row/Image, image aspect auto-size, and `%` children in flex
containers resolved against `line − gaps` (so N columns at (100/N)%+gaps fit exactly - better than
react-pdf/CSS). One shared `resolveExtent` (`layout/box-constraints.ts`); the core is untouched. Still
**wanted-additive**: the small relative-sizing follow-ups (`aspectRatio` on any Box, `min/max` w/h, `%` on
padding/margin/Positioned) + page-break control (keep-together, orphans/widows) — all 1.x minors. Plus the 🔮 wish-list (read/edit existing PDFs, forms, security + signatures,
more e-invoice profiles, framework bindings). See `todo.md` "⭐ Active" + "🔮 Layout & styling".

## Repo facts

- **pnpm monorepo.** `@jasy/pdf` is the root (`src/lib/` is the library); siblings in `packages/`:
  `@jasy/e-invoice` (e-invoicing), `@jasy/cli` (the `jasy` TUI), `@jasy/playground`, **`@jasy/vue`**
  (`packages/vue`) — author PDFs as Vue components, and **`@jasy/nuxt`** (`packages/nuxt`) — the Nuxt module
  (zero-config PDFs client OR server; shipped 2026-06-26). Barrel exports via
  `index.ts` at each level. GitHub org
  `jasy-pdf`, the lib repo is `jasy-pdf/jasy` (**public** since the launch, 2026-06-27).
- The **landing is a separate repo**, `~/projects/jasy-landing` → **jasy.dev** (Nuxt 4 + Nuxt UI 4 +
  Content 3). It has its **own CLAUDE.md + HARD RULES: never start/stop its dev server (Flo runs it),
  only Flo commits.** Package links there use **npmx.dev** (Daniel Roe's registry browser), not npmjs.com.
- License MIT, author Florian Heuberger. **Launched 2026-06-27** (Bluesky + npm; landed with the Vue/Nuxt core
  crew). npm current (alpha + latest dist-tags): `@jasy/pdf`@alpha.12, `@jasy/e-invoice`@alpha.13, `@jasy/cli`@alpha.10,
  `@jasy/vue`@alpha.11, `@jasy/nuxt`@alpha.9 (released via `scripts/release.sh <pkg> <version>` → `<pkg>-v*` tag →
  CI publish; order matters, deps `workspace:*` pin EXACT so dependents re-release when a dep does; the tag also
  builds the GitHub Release notes via `scripts/gh-release.mjs` — changelogen groups + per-commit contributors,
  idempotent upsert). `latest` dist-tag points at the newest alpha per package.
- **Repo locked to the maintainer** (GitHub rulesets, 2026-06-27): only Flo's account pushes/merges/tags; everyone
  else = issues + fork PRs. **CodeRabbit** (`.coderabbit.yaml`) reviews PRs; **Renovate** (`renovate.json`, app
  bypass-listed in the ruleset) opens weekly dependency PRs. Community-health files (CONTRIBUTING / CODE_OF_CONDUCT /
  SECURITY / LICENSE / issue+PR templates / FUNDING) all in. Branch `main`. Runtime deps: `jimp` (images), `fflate`
  (isomorphic deflate), `bidi-js` (UAX #9, behind the `text/bidi.ts` seam and slated to be replaced by
  our own - see `todo.md`); the old `reflect-metadata` DI is gone (decorator removed).
