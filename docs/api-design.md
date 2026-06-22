# JasyPDF — the intuitive API layer

> Status: **DESIGN LOCKED (2026-06-11).** Decisions in §7 are made. Build order: foundation
> first (§8), then the API layer in one clean pass (§9). We do it once — don't touch it three times.

## 1. Principle

Two layers, the lower one already exists:

```
api/      Factory functions — what you write. Declarative, no `new`, CSS/Flutter-familiar.
            │ build a tree of …
elements/ The engine classes (TextElement, ContainerElement, …). Stay as the internal AST.
```

- Every factory is a PascalCase **function** returning an engine element (`Text(...)` → `TextElement`).
- The engine/class API stays public for power users; the factories are sugar, never a wall.
- One import surface: `import { Document, Page, Column, Row, Box, Text, ... } from "@jasy/pdf"`.

Litmus test — must read as cleanly as this:

```ts
Document([
  Page({ size: "A4", margin: 56 }, [
    Column({ gap: 12 }, [
      Text("JasyPDF", { size: 32, bold: true, color: "#1450aa" }),
      Divider(),
      Paragraph(lorem, { font: "Times-Roman" }),
      Box({ border: "steelblue", bg: "#1450aa22", padding: 10, radius: 6 }, [Text("Notiz")]),
      Row({ gap: 8, align: "center" }, [Text("links"), Spacer(), Text("rechts")]),
      Spacer(),
      Text("Footer", { size: 8, align: "center", color: rgb(130, 137, 150) }),
    ]),
  ]),
]);
```

---

## 2. Colors — `ColorInput` (everything goes, but unambiguous)

The format picks the convention, so there's never a guess:

| Input form               | Example                                           | Meaning                        |
| ------------------------ | ------------------------------------------------- | ------------------------------ |
| named (**full CSS set**) | `"steelblue"`, `"rebeccapurple"`, `"transparent"` | the ~148 CSS color names       |
| string hex 6 / 3         | `"#1450aa"` / `"#14a"`                            | CSS RGB                        |
| string hex 8 / 4         | `"#1450aacc"` / `"#14ac"`                         | CSS **RGBA** (alpha LAST)      |
| number                   | `0xff1450aa`                                      | Flutter **ARGB** (alpha FIRST) |
| `rgb(r,g,b)`             | `rgb(20,90,170)`                                  | channels 0–255                 |
| `rgba(r,g,b,a)`          | `rgba(20,90,170,0.8)`                             | a = 0–1                        |
| `Color` instance         | `new Color(20,90,170)`                            | engine layer, still valid      |

`type ColorInput = string | number | Color;` — `rgb()`/`rgba()` return a `Color`. A parser
`toColor(input): Color` normalizes everything; `Color` gains an optional `alpha` (0–1).

**Alpha ⇒ real transparency** → backend `ExtGState` (`/ca` fill, `/CA` stroke). Foundation item (§8).

---

## 3. Units & spacing — `Insets`

Units are PDF points (pt). Padding / margin accept:

```ts
type Insets =
  | number // all sides
  | { x?: number; y?: number } // horizontal / vertical
  | { top?; right?; bottom?; left? } // per side
  | [number, number, number, number]; // [top, right, bottom, left] (engine order)
```

`toEdges(i): [t,r,b,l]` feeds the engine's `PaddingElement`. `gap` is a single number (space
_between_ children of a Column/Row).

---

## 4. Component catalog

### Structure

| Factory                                           | Purpose           | Key options                                                     | Maps to                         |
| ------------------------------------------------- | ----------------- | --------------------------------------------------------------- | ------------------------------- |
| `Document(children)` / `Document(opts, children)` | root              | `meta` (title/author)                                           | `PDFDocumentElement`            |
| `Page(opts, children)`                            | one page template | `size`, `orientation`, `margin: Insets`, **`header`, `footer`** | `PageElement` (+ auto `Column`) |

### Layout

| Factory                                | Purpose              | Key options                                                               | Maps to                                |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| `Column(opts, children)`               | vertical stack       | `gap`, `justify`, `align`                                                    | `ContainerElement`                     |
| `Row(opts, children)`                  | **horizontal** stack | `gap`, `justify`, `align`                                                    | **new `RowElement`**                   |
| `Box(opts, children)`                  | bordered/filled box  | `border`, `borderWidth`, `bg`, `padding`, `width`, `height`, **`radius`** | `RectangleElement` (+ inner `Padding`) |
| `Padding(opts, child)`                 | inset                | `padding: Insets` (`all`/`x`/`y`)                                         | `PaddingElement`                       |
| `Spacer(flex?)`                        | flexible gap         | `flex`                                                                    | `ExpandedElement` (empty child)        |
| `Expanded(opts, child)`                | child fills leftover | `flex`                                                                    | `ExpandedElement`                      |
| `Center(child)` / `Align(opts, child)` | alignment wrapper    | `align`                                                                   | Column/Row align                       |
| `SizedBox(opts, child?)`               | fixed size / strut   | `width`, `height`                                                         | `SizedContainerElement`                |

### Content

| Factory                    | Purpose                        | Key options                                        | Maps to        |
| -------------------------- | ------------------------------ | -------------------------------------------------- | -------------- |
| `Text(content, opts)`      | `content` = string OR `Span[]` | `size`, `font`, `bold`, `italic`, `color`, `align` | `TextElement`  |
| `span(text, opts)`         | inline run for mixed `Text`    | `size`, `font`, `bold`, `italic`, `color`          | `TextSegment`  |
| `Paragraph(content, opts)` | `Text` with body defaults      | as `Text`                                          | `TextElement`  |
| `Image(src, opts)`         | image                          | `width`, `height`, `fit`, **`radius`**             | `ImageElement` |
| `Divider(opts?)`           | horizontal rule                | `color`, `thickness`, `margin`                     | `LineElement`  |
| `Line(opts)`               | explicit line                  | `from`, `to`, `color`, `thickness`                 | `LineElement`  |

### After the core API

| `Grid` / `Table` | rows × cols, auto + fixed widths | `columns: ("auto" \| number \| "1fr")[]`, `gap` | built on `Row`/`Column` |

---

## 5. Alignment model (Flutter-style) — FULL in v1

Column: main axis vertical, cross axis horizontal. Row: swapped.

- `justify`: `start` (default) · `center` · `end` · `between` · `around` — distribute along the axis.
- `align`: `start` (default) · `center` · `end` · `stretch` — position across the axis.
- `Text.align` (left/center/right) is text-internal, independent of `align`.

Shipping the full model in v1 (foundation work) so we never re-touch alignment.

---

## 6. How the engine is reused (thin sugar)

`Column` → `ContainerElement` · `Row` → new `RowElement` · `Box` → `RectangleElement` + inner
`Padding` (shrink-wraps already) · `Spacer`/`Expanded` → `ExpandedElement` · `Divider`/`Line` →
`LineElement` (hides the `xEnd:0` trick) · `Text`/`span` → `TextElement`/`TextSegment` · `Image` →
`ImageElement(new CustomLocalImage(src))` · `Page` auto-wraps children in a `Column`.

---

## 7. Decisions — LOCKED (2026-06-11)

1. **Naming:** `Column` / `Row` (Flutter/CSS-familiar). ✅
2. **Inline mixed text:** `Text([span("a", {bold:true}), span("b")])`; `Text("plain")` too. ✅
3. **`bold` / `italic` as booleans** (not `weight`/`style`). ✅
4. **Named colors: the FULL CSS set** (~148 names incl. `transparent`). ✅
5. **Border radius: build it now** — into the `Rect` IR + backend; `Box`/`Image` get `radius`. ✅
6. **Header/footer: in v1** — `Page({header, footer}, body)`, repeated on every physical page. ✅
7. **Alignment: full `justify` + `align` in v1.** ✅
8. **Keep the class/engine API exported** alongside the factories. ✅

---

## 8. Foundation — build BEFORE the API layer (so we touch it once)

Ordered, each its own verified slice (sample stays byte-identical where it can; new features get tests):

1. **Opacity** — `alpha` on the IR color + `ExtGState` (`/ca`, `/CA`) in `PdfBackend`. Unlocks RGBA/ARGB.
2. **Border radius** — rounded-rectangle path in the `Rect` IR + backend (Bézier corners); `clip` for
   rounded images. Box/Image `radius`.
3. **Horizontal layout** — a `RowElement` + a horizontal flex helper (mirror of the vertical engine);
   it must also fragment (basis for `Grid`/`Table` later). Biggest piece.
4. **Full alignment** — `justify` (start/center/end/between/around) + `align` (start/center/end/stretch)
   in both the vertical and horizontal flex helpers.
5. **Header/footer** — the page driver lays out `header`/`footer` on every physical page (fixed bands;
   body gets the remaining height). Interacts with pagination.
6. _(carried)_ relax the validator's 0-height rejection (thin dividers).

Foundation-free (data/sugar) but landed with the API layer: the **full CSS color table**.

---

## 9. Sequence (one clean pass)

1. ✅ Lock this design (done).
2. ✅ **Foundation** §8: opacity → radius → horizontal/`Row` → alignment → header/footer (done).
3. ✅ **API layer** (`src/lib/api/`): `toColor` + CSS table, then every factory, on the complete engine
   (done 2026-06-16: color/insets, Text/span/Paragraph, Column/Row, Box, Padding, Spacer/Expanded,
   Divider, Image, Document/Page + `renderPdf`/`renderToBytes`, and the `descriptor` type→factory
   registry binding seam).
4. ✅ **Rewrite the showcase** against the new API — the canonical example + DX regression check (done).
5. ✅ Update `README` to the real, now-rich API (done).

> **Status: API BUILT (2026-06-16).** The vocabulary above ships. Next: Grid/Table (built on Row/Column).

---

## 10. Font management - `addFont` (managed, not pass-through) - NEW 2026-06-21

**Problem with the shipped API.** Custom fonts go through `renderToBytes(doc, { fonts: { Inter: bytes } })`:
you read the file yourself, then bury the registration in the OUTPUT call, then must remember to pass it
every time. Pass-and-forget. No query, no clear "this font is named Inter." This is the anti-pattern we
are leaving.

**The fix.** A font is a Document resource: you register it once on the document; it remembers, manages
and embeds it. The render call says nothing about fonts.

```ts
const doc = Document([
  Page({ size: "A4" }, [Text("Hi", { font: "Inter" })]),
]);

doc.addFont("Inter", "Inter-Regular.ttf"); // a path (Node reads it)
doc.addFont("Brand", { normal: "B.ttf", bold: "B-Bold.ttf" }); // a styled family

doc.getFonts(); // ["Inter", "Brand"]
doc.hasFont("Inter"); // true

await renderToBytes(doc); // pure output - the fonts are already in the document
```

### Typed surface

```ts
/** What you hand `addFont`: a file path (Node reads it), raw bytes (browser), or a styled family. */
type FontSource = string | Uint8Array | FontFamily;

interface FontFamily {
  normal: string | Uint8Array;
  bold?: string | Uint8Array;
  italic?: string | Uint8Array;
  boldItalic?: string | Uint8Array;
}

// methods on the object `Document(...)` returns:
addFont(name: string, source: FontSource): this; // chainable; re-adding a name overwrites
getFonts(): string[]; // the registered names
hasFont(name: string): boolean;
```

| Method                   | Purpose                                | Returns              |
| ------------------------ | -------------------------------------- | -------------------- |
| `addFont(name, source)`  | register a font (path / bytes / family) | `this` (chainable)   |
| `getFonts()`             | the registered names                   | `string[]`           |
| `hasFont(name)`          | is it registered?                      | `boolean`            |

### The rule that makes it worth it - DOCUMENT IT

> **Registered is not embedded.** A font is embedded ONLY if it is actually used (some `Text({ font })`
> references it). Unused registered fonts are dropped at render and cost zero bytes (proven: registering
> an unused font produces a byte-identical PDF). Used faces are subsetted and FlateDecode-compressed. So
> register a whole library freely - you pay only for what you set.

This is exactly why there is **no `removeFont` / `deregisterFont`**: the auto-drop already keeps the
output lean, so removal would be ceremony. (Added later only if a real need appears - preventing
accidental use, or freeing memory in a long-lived process.)

### Consistency - the same shape for the other resources

Fonts are the first managed resource. The same `add* / get* / has*` pattern is the target for the other
pass-through render options, so the Document stays one consistent container and we never bolt on a
second shape:

- **Images** (when registered rather than inline): `addImage` / `getImages` / `hasImage`.
- **Attachments** (ZUGFeRD embedded files, today `renderPdf(doc, { attachments })`): `addAttachment` / ...
- Metadata stays declarative on `Document({ meta })`.

### LOCKED (2026-06-21)

1. Verb family: **`add` / `get` / `has`** (collection idiom; generalizes to image/attachment). ✅
2. `addFont(name, source)` with `source = path | bytes | family`. ✅
3. **No `removeFont`** - unused fonts auto-drop; documented as the headline rule. ✅
4. Lives as **Document methods** (`doc.addFont(...)`), returns `this` for chaining. ✅
5. `renderToBytes(doc, { fonts })` kept for back-compat, but `addFont` is THE way. ✅
