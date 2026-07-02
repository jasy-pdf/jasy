<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/vue</h1>

<p align="center">
  <b>Author PDFs as Vue components - and render them right in the browser.</b>
</p>

React has [`@react-pdf/renderer`](https://react-pdf.org). Vue had nothing. This is it: a thin Vue custom
renderer over the [`@jasy/pdf`](https://npmx.dev/@jasy/pdf) engine. You write a component
tree, you get a real PDF - no headless browser, no server round-trip, no Java.

```vue
<script setup lang="ts">
import { Document, Page, Text, Box, renderToPdf } from "@jasy/vue";
import Invoice from "./Invoice.vue";

async function download() {
  const bytes = await renderToPdf(Invoice); // 100% in the browser
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url);
}
</script>
```

## Why

- **Runs in the browser.** The engine is ESM + isomorphic, so `renderToPdf` produces the PDF bytes
  client-side. No `/api/render`, no Node on the request path. (It works in Node too - same call.)
- **Real layout, real pagination.** Flexbox-style `Row`/`Column`, a fragmenting layout engine, repeating
  table headers - not a drawing API you hand absolute coordinates.
- **Typed props.** `<Text :size :color bold>` autocompletes and type-checks; pass a wrong `fit` and it
  goes red. Boolean shorthands (`<Text bold>`, `<Box relative>`) just work.
- **Extensible.** A custom element type is one `registerElement(type, factory)` away - react-pdf's
  primitive set is closed.

## Install

```bash
pnpm add @jasy/vue @jasy/pdf vue
```

## Components

`Document` · `Page` · `Column` · `Row` · `Box` · `Padding` · `Expanded` · `Spacer` · `Divider` ·
`Image` · `Text` · `Paragraph` · `Span` · `Table` / `TableRow` / `TableCell`.

```vue
<template>
  <Document :size="12" color="#1a1a1a">
    <Page :size="'A4'" :gap="16">
      <Row :justify="'between'">
        <Text :size="22" bold color="#0a2348">Acme GmbH</Text>
        <Text :size="22" bold color="#1450aa">INVOICE</Text>
      </Row>

      <Table :columns="['1fr', 120]" cell-border="#e2e8f0" :cell-padding="9">
        <TableRow header>
          <TableCell><Text bold>Description</Text></TableCell>
          <TableCell><Text bold align="right">Amount (EUR)</Text></TableCell>
        </TableRow>
        <TableRow v-for="item in items" :key="item.desc">
          <TableCell>{{ item.desc }}</TableCell>
          <TableCell
            ><Text align="right">{{ item.amount }}</Text></TableCell
          >
        </TableRow>
      </Table>
    </Page>
  </Document>
</template>
```

A `<TableCell>` holds a plain string **or** any components - a `Box` with a `Text`, an `Image`, a whole
subtree. `:columns` takes points (`120`), fractions (`"1fr"`) or `"auto"` (sized to the widest cell). A
row marked `header` repeats at the top of every page the table flows onto.

## Three ways to import (clash-safe)

Vue UI libraries often export their own `Row` / `Text` / `Box`. Pick whichever avoids a collision:

```ts
// 1. Direct - aliasing is fine: `import { Row as PdfRow } from "@jasy/vue"`
import { Document, Page, Text } from "@jasy/vue";

// 2. Namespace - no collisions at all
import * as Pdf from "@jasy/vue"; // <Pdf.Document> <Pdf.Text>

// 3. Plugin with a prefix - global, no per-file imports
app.use(jasyVue, { prefix: "Pdf" }); // <PdfDocument> <PdfText>
```

## Custom fonts and images (bytes)

Both load as `Uint8Array`, so the same code runs in the browser and in Node:

```vue
<script setup lang="ts">
const props = defineProps<{ font: Uint8Array; logo: Uint8Array }>();
</script>

<template>
  <Document :fonts="{ GreatVibes: props.font }">
    <Page>
      <Text :font="'GreatVibes'" :size="44">Jasy Atelier</Text>
      <Image :src="props.logo" :width="84" :height="84" :fit="'cover'" :radius="42" />
    </Page>
  </Document>
</template>
```

## API

- `renderToPdf(root, props?, options?) => Promise<Uint8Array>` - the PDF bytes. Browser or Node.
- `renderToPdfString(root, props?, options?) => Promise<string>` - the raw PDF string.
- `options` are the `@jasy/pdf` `RenderOptions` and flow straight through - e.g.
  `renderToPdf(Doc, props, { encrypt: { userPassword: "secret" } })` for AES-256 password protection (also
  `fonts`, `compress`, `onOverflow`, …).
- `toDocumentDescriptor(root, props?)` - the framework-agnostic descriptor (the seam a Node service can
  receive from the browser).
- `jasyVue` - the global-registration plugin (`{ prefix }`).

## Try it

```bash
git clone https://github.com/jasy-pdf/jasy && cd jasy && pnpm install
cd packages/vue && pnpm play
```

The playground renders four samples in the browser, including a `Showcase` with a custom `.ttf`, a JPEG,
`v-for` and computed totals - all client-side.

---

Part of [Jasy](https://jasy.dev) - a declarative, dependency-light PDF toolkit in pure TypeScript.
MIT, by Florian Heuberger.
