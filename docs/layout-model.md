# Layout model v2 - design

> **Status: draft for approval; open questions answered (section 8).** Nothing in here is built. Decided 2026-10-15: the layout model is
> rebuilt during the beta, the full way, with no intermediate shortcut. This document is the contract
> each stage is held to. Once approved it stays as the reference for how layout works.

## 1. Why

Layout today does two jobs in one call. `calculateLayout(constraints, offset, ctx)` computes an
element's size **and** writes ABSOLUTE page coordinates into the element and its whole subtree. So
"measure a child, then place it" is two full layouts of that child, and the doubling repeats at
every flex level.

Measured 2026-10-15 with 48 text leaves nested ever deeper (column, box, row, repeating; it becomes
the call-count test in stage 2):

| depth | layouts per leaf | ms per render |
| ----- | ---------------- | ------------- |
| 3     | 80               | 6.9           |
| 5     | 320              | 16.1          |
| 6     | 640              | 37.4          |
| 7     | 2,560            | 126           |
| 8     | 10,240           | 496           |

Per render, a leaf at depth d is laid out 2^d times in pass 1, 2^(d-1) times while the page is
split, and 2^d times on its page. Pass 1's result is thrown away. It runs only because
`PageElement` merges its config during layout. A table with an `auto` column is rebuilt from scratch
on every layout call: 10 rebuilds for a one-page table.

The text cache (`ce6857c`, `6764f3f`) removed the expensive half of each call, breaking a paragraph
into lines. It cannot remove the calls themselves. Seven or eight levels is ordinary nesting (page,
column, card, column, row, box, column, text).

## 2. What every mature engine does

Read in the source on 2026-10-15, at these revisions:

- Flutter `flutter/flutter@0cca2aea23`: `packages/flutter/lib/src/rendering/object.dart`, `box.dart`,
  `flex.dart`, `paragraph.dart`, `painting/text_painter.dart`
- Yoga `facebook/yoga@6ac92f4c35`: `yoga/algorithm/CalculateLayout.cpp`, `Cache.cpp`,
  `yoga/node/LayoutResults.h`
- Chromium LayoutNG `third_party/blink/renderer/core/layout/`: `layout_ng.md`,
  `physical_fragment_link.h`, `constraint_space.h`, `layout_box_hot.cc`, `measure_cache.h`
- react-pdf `diegomura/react-pdf@e7b14db1e5`: `packages/layout/src/steps/resolvePagination.ts`,
  `resolveDimensions.ts`, `text/measureText.ts`

1. **A position is relative to the parent, and the parent owns it.** Flutter keeps it in
   `BoxParentData.offset`, Yoga in its parent-relative position, LayoutNG in
   `PhysicalFragmentLink.offset`. LayoutNG's comment: "Fragments themselves have no position
   information allowing entire fragment subtrees to be reused and cached regardless of placement."
   Absolute coordinates exist only while painting.
2. **Each child is laid out once per pass.** Flutter's `RenderFlex` lays every non-flex child out
   once and every flex child once (`flex.dart` `_computeSizes`). The parent places children by
   writing their offsets. It never re-enters them.
3. **Measuring is separate and changes nothing.** Flutter has `getDryLayout`: "computes the desired
   size for the given constraints without changing any internal state". It even keeps a second
   `TextPainter` so a measurement cannot clobber the layout used for painting. Yoga separates
   `cachedMeasurements[8]` from `cachedLayout`, and LayoutNG separates `kMeasure` from `kLayout`.
4. **One function computes size for both.** Flutter's `_computeSizes(layoutChild: ...)` runs with a
   real or a dry child callback, so a measured size cannot differ from a laid-out one. This is jasy's
   own rule, "measured equals drawn", one level up.
5. **The cache key is the complete input.** Flutter compares full `BoxConstraints`. LayoutNG compares
   the whole constraint space, including the percentage basis, and writes the rule down: layout may
   read nothing outside the node, its style, its children and its constraint space.
6. **Paginated layout** (only LayoutNG really does it) keys a fragmented result on the page height and
   the offset within the page as well.

A counter-example is react-pdf. It rebuilds the whole Yoga tree at every page split, and its text memo
leaves the width out of the key.

## 3. The model

### 3.1 Size and position are separated

- An element's layout computes **its size** from its constraints and lays out each child **once**.
- It then **places** each child by setting the child's `offset`: the child's top-left, relative to
  this element's top-left.
- A wrapper that puts its child exactly where it is itself (`Expanded`, `Link`, `Anchor`, `Bookmark`,
  `DefaultTextStyle`, `KeepTogether`, `StructGroup`, `Deferred`, `PageBuilder`) gives the child its
  own offset and passes the render scope on unchanged: both are relative to the same origin.
- An element stores only `size` and `offset`. No element holds an absolute coordinate.
- Absolute coordinates are formed in the render pass. Each renderer receives a `RenderScope`:
  `origin` is the absolute point its element's offset is relative to (the parent's top-left), and
  `frame` the nearest positioning frame. A renderer that places children hands them
  `origin + its own offset` (`within()` in `renderer-registry.ts`). The IR stays absolute, exactly as
  before, so `PdfBackend`, `flipY` and serialization do not change.
- Offsets are **not** emitted as PDF `cm` transforms. Links, anchors, outlines and form fields need
  absolute page rectangles (`page-renderer.ts` reads them straight from the nodes), and the backend has
  no matrix stack.

### 3.2 Measuring without laying out

- Every element answers `measure(constraints, inputs): Size` with **no side effects**. It writes no
  offsets and no layout state.
- `measure` and `layout` share one sizing function per element, parameterised by "how to size a
  child": measure a child, or lay it out. That is Flutter's `_computeSizes`, and it keeps the two
  answers from ever disagreeing.
- **One exception, deliberate:** `Text.measure` resolves the inherited style and fills its memos
  (`displayed`, `measured`). Both are a pure function of the context, so the same inputs leave the
  same state, which a later layout reads back unchanged. Nothing positional is written.
- Today's measurements become `measure`:
  - flex basis, shrink and stretch measurement
  - `minIntrinsicMain`
  - table `auto` / `minmax` columns
  - `keepTogether`'s height check
  - every "how tall would you be" question inside `fragment()`
- **Flex** measures, decides the final constraints, then lays out each child **once** under them.
- An `align: stretch` child on an unbounded cross axis gets the cross extent from the measure pass and
  is laid out once with it. Today it is laid out twice under different constraints.

### 3.3 The cache

Built in stage 4 as ONE mechanism: `PDFElement.measure` asks `layout/layout-cache.ts`, which keeps a
few remembered sizes per element (4, as Yoga keeps a handful: flex asks one child at more than one
width). There is no layout cache: measured, only 0-5% of `calculateLayout` calls repeat in real
documents (header and footer per page), so caching placement would add risk for nothing.

- **The key is the complete input of the sizing function:**
  - the constraints - only the part the element's size reads (`sizeInputs`; a `Text` reads only its
    width, so an overflowing Column's capped-height question shares the answer);
  - the font metrics' identity, `fontEpoch` and the kerning flag;
  - the inherited text style, by identity. `DefaultTextStyle` returns the same merged object for the
    same inherited one, so identity is enough;
  - `pageConfig` and `pageInfo`, only for an element that `dependsOnPage()` (see 3.5).
- **The rule that makes the cache safe** (LayoutNG's): sizing reads nothing outside the element's own
  props, its children, the constraints and the inputs above. Anything that affects only pagination
  decisions (`belowContent`, `onOverflow`, `pageBodyHeight`) or placement (`frame`) is not a sizing
  input.
- **Invalidation:** elements are immutable after construction, so the only reason to re-size is a
  different key. Nothing is "dirty".
- **Held by tests:** `tests/unit/layout/layout-cache.test.ts` changes one key field at a time (each
  sabotage-probed), and every pinned document renders byte-identically with the cache on and off.

### 3.4 Out-of-flow children (`Positioned`)

Today a `Positioned` registers a closure on `ctx.frame.place` **during its parent's layout**, and the
frame owner (the page, or a `Box({ relative: true })`) runs the queue after sizing itself. That is a
side effect of layout, and a cache hit would skip it: the child would never be placed.

New rule:

- Layout has no side effects.
- A frame owner, after its own layout, walks its subtree once for the `Positioned` descendants that
  belong to it (stopping at nested frame owners), lays each one out, and stores its offset **relative
  to the frame owner**. The list depends only on the immutable tree, so it is computed once.
- **Paint order is tree order** (as Flutter's `Stack`): a `Positioned` is drawn where it sits in the
  tree, so one early in a header lies UNDER the body (a watermark) and one as a last child lies on
  top (a badge). The author picks the layer by the position in the tree. This is the behaviour
  before the rebuild and it stays until `z-index` exists; `z-index` comes later on top of it.
- At render, positioned content is drawn at `frameOrigin + offset`. Renderers take a
  `RenderScope { origin, frame }`: a frame owner sets `frame` for its subtree, and a `Positioned`
  draws its child with `origin = frame` at its own place in the tree (no render-time state in the
  elements).
- `z-index` later: the frame owner already finds its `Positioned` descendants structurally
  (`positionedIn`). A layer other than the default is then painted by the frame owner, below or
  above its flow content; the default stays tree order.
- Measured why not CSS order without `z-index`: gallery `18-watermark` put "CONFIDENTIAL" over the
  body text instead of under it.

### 3.5 Subtrees built during layout

- **`Deferred`** (tables with measured columns) keeps its built subtree and rebuilds only when its
  inputs change (`BuiltFromContext`: the context half of the size key; the page counts only if the
  built subtree depends on it). A table is built once per render instead of once per layout call.
- **`PageBuilder`** builds with the real page info on each page, so its size may differ per page (a
  conditional header may shrink on later pages). `dependsOnPage()` is true for it, for `Page`, and for
  every element holding one (asked through `layoutChildren`, remembered - the tree is immutable). A
  `Deferred` that has not built yet answers true. Only those elements key on the page; every other
  size is reused across pages and across the pagination and render passes.

### 3.6 Pages and pagination

- The `fragment(maxHeight, width, ctx)` protocol stays. Its height questions use `measure`.
- **Pass 1 goes away.** The page config merge moves out of `PageElement.calculateLayout` into a pure
  function that the page driver calls. Each physical page is then laid out exactly once, right before
  it is rendered.
- **Shared instances** are header, footer and the repeating table header, which are reused on every
  page. They become safe by construction, because positions live in the parent.
- Fragment results are not cached at first. LayoutNG caches per fragment, keyed on page height and
  position on the page. That is a later step, and only if measurement shows it is needed.

### 3.7 Single-child wrappers

Wrappers forward pagination signals inconsistently today. `StructGroup`, `Expanded`, `DefaultTextStyle`
and `RepeatingHeader` drop `forceBreak` from `fragment()`. Most forward neither `hasForcedBreak` nor
`needsBoundedMain`, and `Anchor`, `Bookmark`, `Link`, `Rotated`, `RotatedBox`, `PageBuilder` and
`Deferred` forward nothing. They get one shared base that forwards everything. **This changes
behaviour** (a `PageBreak` inside a `Link` starts to work), so it is its own visible stage, not hidden
inside the refactor.

Built (6b): `ProxyElement` (`elements/layout/proxy-element.ts`, Flutter's `RenderProxyBox`) is the base
of `Link`, `Anchor`, `Bookmark`, `StructGroup`, `DefaultTextStyle` and `KeepTogether`. It forwards
sizing (`relativeSizeFactor`, `needsBoundedMain`, `minIntrinsicMain`) and pagination (`isPageBreak`,
`hasForcedBreak`, `breaksBefore/After`, `fragment` with `forceBreak`). A wrapper adds only
`childContext` and `rewrap(piece, continued)`: a jump target or outline entry marks the FIRST piece of
a split only, a link stays clickable on every piece. `Expanded` and `RepeatingHeader` pass `forceBreak`
and `hasForcedBreak` on; `Rotated` passes sizing and break-before/after but is never split. `PageBuilder`
and `Deferred` build their child during layout and the signals carry no context, so they stay as they
are.

Built (6c): to a surrounding Row or Column a `ProxyElement` is not there (CSS `display: contents`).
`PDFElement.proxied()` names what an element is transparent for; `layout/flex-item.ts` reads a child's
flex item through that chain - its `Expanded`, `alignSelf`, `order`, `flexShrink` - and a value set on
the wrapper itself wins. `order`/`flexShrink` are unset (`undefined`) by default so "set" can be told
from "default"; the defaults 0 and 1 live in `flex-item.ts`.

## 4. Floating point and byte stability

- An absolute coordinate is computed as `parentOrigin + offset` in the render pass. Today it is built
  inside layout in a sequence of additions. A different grouping can change the last bit, and with it
  a printed digit (`toFixed(3)` in `Td`, `toFixed(2)` in `/Rect`).
- **The new model computes positions its own way** (`parentOrigin + offset`), and it does not
  reproduce the old addition order. Where that changes a last printed digit, the hashes are re-pinned.
- **Never silently:** every re-pin lists which document, which number, old and new, and shows that
  nothing moved by more than a rounding step (a render is compared visually as well). Anything larger
  is a bug, not a re-pin.
- Everything else stays byte-identical under `tests/unit/renderer/layout-fingerprint.test.ts`, the
  gallery and the invoice renders.

## 5. What breaks

- `calculateLayout(constraints, offset, ctx)` is replaced by `layout(constraints, inputs)` and
  `measure(constraints, inputs)`, with the offset owned by the parent.
- Only `PDFElement` is exported, and `RendererRegistry` is not, so no third party can register a
  custom element today. The break hits our own tests: 33 test files call `calculateLayout` directly
  (118 call sites), and about 19 assert absolute positions. Those move to rendered output or to
  `origin + offset`.
- Vue, Nuxt, e-invoice and the CLI read no positions after layout. They are not affected.
- Release notes say it. It is a beta.

## 6. Stages

Each stage is its own branch and PR, reviewed and merged before the next one starts. Each is
byte-identical unless it says otherwise (section 4 for last digits). All stages, 6 and 7 included,
are part of this rebuild. **No release in between:** after the last stage we test, talk, show the
results, and then decide.

| Stage | What                                                                                                                                                                                                                                                                                                 | Behaviour change                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0     | This document, approved                                                                                                                                                                                                                                                                              | -                                                                |
| 1     | Pre-work: `Expanded` reuses the previous call's width on an unbounded axis (history-dependent, `expanded-element.ts:156`); `SizedContainerElement` is dead code; the page config merge moves out of layout                                                                                           | `Expanded` only where it was wrong                               |
| 2     | `measure()` with no side effects, one sizing function per element, used for every measurement                                                                                                                                                                                                        | none                                                             |
| 3     | Relative offsets: elements store `offset`, renderers receive `origin`, frame-origin stack for `Positioned`, side channels from `origin`                                                                                                                                                              | `Positioned` paints on top (CSS) where it was not the last child |
| 4     | One measure cache with the declared inputs; `dependsOnPage`; `Deferred` keeps its subtree. (A layout cache was dropped after measuring: 0-5% repeats.)                                                                                                                                               | none                                                             |
| 5     | Pass 1 removed (done: the page driver lays each page out once, before drawing; page config resolved, never read back)                                                                                                                                                                                | none                                                             |
| 6     | Shared wrapper base, all signals forwarded                                                                                                                                                                                                                                                           | yes, visible                                                     |
| 7     | Fragment clones keep all properties (`Container` drops min/max/aspectRatio, `Text` drops `breakWord`, `hyphenate`, `ligatures`, the fallback stack). Built (7b): every clone ends in `PDFElement.asPieceOf` (tagging identity + flex item); Box/Column keep `widthRules` and pack at their own width | yes, visible                                                     |

**Measure of success**, a test written in stage 2 and tightened each stage after: the depth case from
section 1, asserting **layouts per leaf** (today 2^d) and pinned to the byte. The goal is a small
constant per leaf, independent of depth.

## 7. Tests that hold it

- **`layout-fingerprint.test.ts`:** 12 documents pinned to the byte, sabotage-probed (a wrong cache
  key, a gap off by 0.01pt, a forgotten space are each caught). The depth case and a `Positioned` case
  are added in stage 2.
- **The cache switch** (as `textMeasureCache`): every document is rendered with the caches on and off,
  and must produce the same bytes.
- **A call-count test:** layouts per leaf at depth 8, so a regression to exponential cost fails at
  once instead of showing up in a benchmark months later.

## 8. Decisions (Flo, 2026-10-15)

1. **Positioned paint order = tree order** (section 3.4). Revised 2026-10-16 after the watermark
   render: CSS order without `z-index` puts every watermark on top. `z-index` is a later goal.
2. **Floating point:** the rebuild is new and faster; it does not reproduce the old addition order.
   Last-digit differences are re-pinned with a listed diff (section 4).
3. **Stages 6 and 7** are part of the rebuild. It is carried through, not split.
4. **No release during the rebuild.** Tests, talk, show - then decide.
