<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/vue</h1>

<p align="center">
  <b>Author PDFs as Vue components - and render them right in the browser.</b>
</p>

A thin Vue custom renderer over the [`@jasy/pdf`](https://npmx.dev/@jasy/pdf) engine. You write a
component tree, you get a real PDF: no headless browser, no server round-trip, no Java.

```vue
<script setup lang="ts">
import { renderToPdf } from "@jasy/vue";
import Invoice from "./Invoice.vue";

async function download() {
  const bytes = await renderToPdf(Invoice, { customer: "ACME GmbH" }); // in the browser or in Node
  window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
}
</script>
```

## Why

- **Runs in the browser.** `renderToPdf` produces the PDF bytes client-side. No `/api/render`, no Node
  on the request path. The same call works in Node.
- **Real layout, real pagination.** `Row`/`Column` flex, wrapping, `%` sizes, a table whose header row
  repeats on every page, newspaper columns. Not a drawing API you hand absolute coordinates.
- **Vue, all of it.** Props, slots, `v-for`, `v-if`, `computed`, `provide`/`inject` - the renderer walks
  the tree Vue builds.
- **Typed props.** Every engine option is a declared prop, held to the engine by a test: it
  autocompletes and type-checks, and a wrong value goes red in your editor.

## Install

```bash
pnpm add @jasy/vue @jasy/pdf vue
```

Vue 3.4 or newer.

## Components

| Group      | Components                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Structure  | `Document` · `Page` · `PageBreak` · `KeepTogether` · `DefaultTextStyle` · `PageBuilder`                |
| Layout     | `Column` · `Row` · `Box` · `Padding` · `Expanded` · `Spacer` · `Positioned` · `Rotated` · `RotatedBox` |
| Text       | `Text` · `Paragraph` · `Span` · `PageNumber` · `PageCount` · `SubPageNumber` · `SubPageCount`          |
| Content    | `Image` · `Svg` · `Canvas` · `Divider` · `Table` · `TableRow` · `TableCell`                            |
| Flow       | `Flow` · `Region` · `ColumnBreak` · `SplitView`                                                        |
| Navigation | `Link` · `Anchor` · `Bookmark`                                                                         |
| Forms      | `TextField` · `Checkbox` · `RadioGroup` · `Dropdown` · `ListBox` · `PushButton` · `SignatureField`     |

The props are the options of the matching `@jasy/pdf` function, documented at [jasy.dev](https://jasy.dev).
Where a template has its own way, it is used:

- **Repeating areas are slots.** `<Page>` takes `#header` and `#footer`: laid out once and repeated on
  every page the content flows onto, with the space they need reserved.
- **What depends on the page is a scoped slot**, built for every page it lands on:
  `<PageBuilder #default="{ pageNumber, pageCount }">`.
- **A Flow's page is the `#page` slot**, rendered in place, so `inject` works in it.
- **A form field's label is its default slot**: `<Checkbox name="agree">I agree</Checkbox>`.
- **Choices are a prop**, since a template has no second argument: `<Dropdown :options="['DE', 'AT']">`.

```vue
<template>
  <Document :size="11">
    <Page size="A4" :gap="16">
      <template #header>
        <Text :size="9" color="#94a3b8">Acme GmbH</Text>
      </template>

      <Table :columns="['1fr', 120]" cell-border="#e2e8f0" :cell-padding="8">
        <TableRow header>
          <TableCell>Description</TableCell>
          <TableCell>Amount (EUR)</TableCell>
        </TableRow>
        <TableRow v-for="item in items" :key="item.desc">
          <TableCell>{{ item.desc }}</TableCell>
          <TableCell>{{ item.amount }}</TableCell>
        </TableRow>
      </Table>

      <template #footer>
        <PageBuilder #default="{ pageNumber, pageCount }">
          <Text :size="9" align="center">Page {{ pageNumber }} of {{ pageCount }}</Text>
        </PageBuilder>
      </template>
    </Page>
  </Document>
</template>
```

## Two ways to import

Vue UI libraries often export their own `Row` / `Text` / `Box`. Pick whichever avoids a collision:

```ts
// Direct - alias where needed: `import { Row as PdfRow } from "@jasy/vue"`
import { Document, Page, Text } from "@jasy/vue";

// Namespace - no collisions at all: <Pdf.Document> <Pdf.Text>
import * as Pdf from "@jasy/vue";
```

A prefix without per-file imports is [`@jasy/nuxt`](https://npmx.dev/@jasy/nuxt), which auto-imports
every component under one (`<JasyDocument>`, `<JasyText>`, ...).

## Fonts and images

Both load as bytes, so the same code runs in the browser and in Node:

```vue
<script setup lang="ts">
const props = defineProps<{ font: Uint8Array; photo: Uint8Array }>();
</script>

<template>
  <Document :fonts="{ GreatVibes: props.font }">
    <Page>
      <Text font="GreatVibes" :size="44">Jasy Atelier</Text>
      <Image :src="props.photo" :width="84" :height="84" fit="cover" :radius="42" />
    </Page>
  </Document>
</template>
```

`<Svg>` takes markup, a file path (Node) or the file's bytes and keeps a logo a vector; `<Image>`
recognizes an SVG source by itself. `<Canvas :paint>` hands your function a typed pen and the size the
layout resolved, for a chart or a seal.

## API

- `renderToPdf(root, props?, options?) => Promise<Uint8Array>` - the PDF bytes. Browser or Node.
- `renderToPdfString(root, props?, options?) => Promise<string>` - the raw PDF string.
- `options` are the `@jasy/pdf` `RenderOptions`, e.g. `{ encrypt: { userPassword: "secret" } }` for
  AES-256, `{ accessible: true }` for a tagged PDF, `onDiagnostic` for what the engine has to say.
- `toDocumentDescriptor(root, props?)` - the engine descriptor of the document, a plain object. Before
  posting it as JSON, encode font and image bytes yourself (JSON has no `Uint8Array`) and decode them on
  the other side. Functions do not survive JSON at all, so a document with a `<Canvas>`, a `<Flow>` or a
  `<PageBuilder>` goes through `renderToPdf`.

## Try it

```bash
git clone https://github.com/jasy-pdf/jasy && cd jasy && pnpm install && pnpm run build
pnpm --filter @jasy/vue play
```

The playground renders twelve documents in the browser, side by side with their source: an invoice
that grows across pages, a newspaper, layout, typography, drawing, fonts, form fields, encryption.

---

Part of [Jasy](https://jasy.dev) - a declarative, dependency-light PDF toolkit in pure TypeScript.
MIT, by Florian Heuberger.
