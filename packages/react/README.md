<p align="center">
  <img src="https://raw.githubusercontent.com/jasy-pdf/jasy/main/docs/logo.png" width="120" alt="jasy">
</p>

<h1 align="center">@jasy/react</h1>

<p align="center">
  <b>Author PDFs as React components - and render them right in the browser.</b>
</p>

A thin React renderer over the [`@jasy/pdf`](https://npmx.dev/@jasy/pdf) engine. You write a component
tree, you get a real PDF: no headless browser, no server round-trip, no Java.

```tsx
import { Document, Page, Row, Text, Table, TableRow, TableCell, renderToPdf } from "@jasy/react";

function Invoice({ items }: { items: { desc: string; amount: string }[] }) {
  return (
    <Document size={11}>
      <Page size="A4" gap={16} footer={<Text size={9}>Acme GmbH · Berlin</Text>}>
        <Row justify="between">
          <Text size={22} bold color="#0a2348">
            Acme GmbH
          </Text>
          <Text size={22} bold color="#1450aa">
            INVOICE
          </Text>
        </Row>
        <Table columns={["1fr", 120]} cellBorder="#e2e8f0" cellPadding={8}>
          <TableRow header>
            <TableCell>Description</TableCell>
            <TableCell>Amount (EUR)</TableCell>
          </TableRow>
          {items.map((item) => (
            <TableRow key={item.desc}>
              <TableCell>{item.desc}</TableCell>
              <TableCell>{item.amount}</TableCell>
            </TableRow>
          ))}
        </Table>
      </Page>
    </Document>
  );
}

const bytes = await renderToPdf(<Invoice items={items} />); // in the browser or in Node
```

## Why

- **Runs in the browser.** `renderToPdf` produces the PDF bytes client-side. No `/api/render`, no Node
  on the request path. The same call works in Node.
- **Real layout, real pagination.** `Row`/`Column` flex, wrapping, `%` sizes, a table whose header row
  repeats on every page, newspaper columns. Not a drawing API you hand absolute coordinates.
- **React, all of it.** Hooks, context, lists with `key`, your own components. A component that
  throws fails the render with that error.
- **Typed by the engine.** Every prop type IS the engine's option type, so a new engine option is a
  typed prop the day it ships, and a wrong value goes red in your editor.
- **The same bytes.** A document in JSX renders byte-for-byte like the same document written with the
  `@jasy/pdf` functions. The test suite holds every component to that.

## Install

```bash
pnpm add @jasy/react @jasy/pdf react
```

React 19.

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
Where React has its own way, it is used:

- **Text is children.** `<Text bold>Total: {sum}</Text>`, and `<Span>` styles part of a line.
- **A form field's label is its children.** `<Checkbox name="agree">I agree</Checkbox>`.
- **Repeating areas are props.** `<Page header={<Logo />} footer={<PageNumber />}>`: laid out once and
  repeated on every page the content flows onto, with the space they need reserved.
- **What depends on the page is a function child**, built for every page it lands on:
  `<PageBuilder>{({ pageNumber, pageCount }) => <Text>Page {pageNumber} of {pageCount}</Text>}</PageBuilder>`.
- **A Flow's page is a render prop**, rendered in place, so hooks and context work in it:

```tsx
<Flow
  page={({ index }) => (
    <Row gap={14}>
      <Expanded>
        <Region />
      </Expanded>
      <Region width={index === 0 ? 150 : 100} />
    </Row>
  )}
>
  {paragraphs.map((p) => (
    <Text key={p}>{p}</Text>
  ))}
</Flow>
```

## Fonts and images

Both load as bytes, so the same code runs in the browser and in Node:

```tsx
<Document fonts={{ GreatVibes: fontBytes }}>
  <Page>
    <Text font="GreatVibes" size={44}>
      Jasy Atelier
    </Text>
    <Image src={photoBytes} width={84} height={84} fit="cover" radius={42} />
  </Page>
</Document>
```

## API

- `renderToPdf(element, options?) => Promise<Uint8Array>` - the PDF bytes. Browser or Node.
- `renderToPdfString(element, options?) => Promise<string>` - the raw PDF string.
- `options` are the `@jasy/pdf` `RenderOptions`, e.g. `{ encrypt: { userPassword: "secret" } }` for
  AES-256, `{ accessible: true }` for a tagged PDF, `onDiagnostic` for what the engine has to say.
- `toDocumentDescriptor(element)` - the plain, serializable descriptor of the document, e.g. to post
  to a server. A `Flow` and a `PageBuilder` render during the PDF render, so a document with one goes
  through `renderToPdf`.

## Try it

```bash
git clone https://github.com/jasy-pdf/jasy && cd jasy && pnpm install && pnpm run build
pnpm --filter @jasy/react play
```

The playground renders twelve documents in the browser, side by side with their source: an invoice
that grows across pages, a newspaper, layout, typography, drawing, fonts, form fields, encryption.

---

Part of [Jasy](https://jasy.dev) - a declarative, dependency-light PDF toolkit in pure TypeScript.
MIT, by Florian Heuberger.
