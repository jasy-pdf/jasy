<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/jasy-nuxt.png" width="120" alt="jasy nuxt">
</p>

<h1 align="center">@jasy/nuxt</h1>

<p align="center">
  <b>Author PDFs as Vue components in Nuxt - render them in the browser or on a server route, zero config.</b>
</p>

The Nuxt module for [`@jasy/vue`](https://npmx.dev/@jasy/vue) and [`@jasy/pdf`](https://npmx.dev/@jasy/pdf).
Add it to `modules` and the components and render helpers are just there - no imports, no wiring. Render a
PDF client-side with `usePdf`, or stream one from a Nitro route with `definePdfHandler`. No headless
browser, no Java.

## Install

```bash
npx nuxi module add @jasy/nuxt
```

That installs the package and adds it to `modules` for you. Or wire it up by hand:

```bash
pnpm add @jasy/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@jasy/nuxt"],
});
```

## Client: `usePdf`

Author a PDF as a Vue component - the jasy components are auto-registered, so no imports:

```vue
<!-- Invoice.vue -->
<template>
  <Document :size="11">
    <Page :size="'A4'" :margin="48">
      <Text :size="24" bold color="#0a2348">Invoice #{{ id }}</Text>
    </Page>
  </Document>
</template>
```

```vue
<script setup lang="ts">
import Invoice from "./Invoice.vue";

const { open, download, pending } = usePdf(Invoice, { props: { id: 42 } });
</script>

<template>
  <button :disabled="pending" @click="open">View PDF</button>
</template>
```

`open()` and `download()` render on demand and reuse the result, so one click is one render. Pass
`{ immediate: true }` to pre-render on mount.

## Server: `definePdfHandler`

The `@jasy/pdf` tree API is auto-imported in `server/`. No Vue, no browser - build the document and stream
it:

```ts
// server/api/invoice/[id].get.ts
export default definePdfHandler((event) =>
  Document([
    Page({ size: "A4", margin: 48 }, [
      Text(`Invoice #${getRouterParam(event, "id")}`, { size: 24, bold: true }),
    ]),
  ]),
);
```

`GET /api/invoice/42` streams `application/pdf`. Need auth or a data fetch first? Use
`sendPdf(event, doc, opts)` inside your own handler, or `renderToBytes(doc)` to just get the bytes (save
them, attach to an email, anything).

### Caching

Wrap a route in Nitro's cache - keyed by path + query, so it caches per request out of the box:

```ts
export default definePdfHandler(build, { cache: { maxAge: 3600 } });
```

Expired entries re-render fresh (`swr` is off by default) - a stale invoice is never served.

## What the module sets up

- **Components** for templates: `Document` · `Page` · `Column` · `Row` · `Box` · `Padding` · `Text` ·
  `Image` · `Table` and the rest. Set a `prefix` to dodge name clashes (`prefix: "Pdf"` makes it
  `<PdfDocument>`).
- **Auto-imports**: `usePdf` and `renderToPdf` on the client; the `@jasy/pdf` tree API, `definePdfHandler`
  and `sendPdf` on the server.
- **Bundle-safety**: keeps jimp (the server-side image decoder) out of the client bundle - the browser
  decodes images via canvas instead.

## Options

```ts
export default defineNuxtConfig({
  modules: ["@jasy/nuxt"],
  jasy: {
    autoImport: true, // auto-register components + the tree API (default true)
    prefix: "Pdf", // <PdfDocument> in templates, PdfDocument(...) in server/ (default none)
  },
});
```

## Links

- [`@jasy/pdf`](https://npmx.dev/@jasy/pdf) - the pure-TypeScript PDF engine
- [`@jasy/vue`](https://npmx.dev/@jasy/vue) - author PDFs as Vue components
- [jasy.dev](https://jasy.dev) - documentation

MIT, by Florian Heuberger
