import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { createContext, useContext, useState, type ReactNode } from "react";
import * as pdf from "@jasy/pdf";
import {
  Anchor,
  Bookmark,
  Box,
  Canvas,
  Checkbox,
  Column,
  ColumnBreak,
  DefaultTextStyle,
  Divider,
  Document,
  Dropdown,
  Expanded,
  Flow,
  Image,
  KeepTogether,
  Link,
  ListBox,
  Padding,
  Page,
  PageBreak,
  PageBuilder,
  PageCount,
  PageNumber,
  Paragraph,
  Positioned,
  PushButton,
  RadioGroup,
  Region,
  Rotated,
  RotatedBox,
  Row,
  SignatureField,
  Spacer,
  Span,
  SplitView,
  SubPageCount,
  SubPageNumber,
  Svg,
  Table,
  TableCell,
  TableRow,
  Text,
  TextField,
  renderToPdf,
  renderToPdfString,
  toDocumentDescriptor,
} from "../src/index.ts";

// The oracle is the TypeScript API: the same document written in JSX must give the same bytes.

const SIZE = { width: 300, height: 260 };
const tsDoc = (content: pdf.PDFElement[], page: pdf.PageOptions = {}) =>
  pdf.Document([pdf.Page({ size: SIZE, margin: 20, ...page }, content)]);
const jsxDoc = (content: ReactNode, page: Record<string, unknown> = {}) => (
  <Document>
    <Page size={SIZE} margin={20} {...page}>
      {content}
    </Page>
  </Document>
);
async function same(ts: pdf.JasyDocument, jsx: ReactNode) {
  const a = await pdf.renderToBytes(ts);
  const b = await renderToPdf(jsx);
  expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="teal"/></svg>`;

describe("JSX draws what the TypeScript API draws", () => {
  it("text, spans and the text cascade", async () => {
    const n = 3;
    await same(
      pdf.Document({ size: 13, color: "#222" }, [
        pdf.Page({ size: SIZE, margin: 20 }, [
          pdf.Text("Total: 3", { bold: true }),
          pdf.Text([pdf.span("Hello "), pdf.span("world", { color: "red", underline: true })]),
          pdf.DefaultTextStyle({ italic: true }, [pdf.Paragraph("Inherits italic.")]),
        ]),
      ]),
      <Document size={13} color="#222">
        <Page size={SIZE} margin={20}>
          <Text bold>Total: {n}</Text>
          <Text>
            <Span>Hello </Span>
            <Span color="red" underline>
              world
            </Span>
          </Text>
          <DefaultTextStyle italic>
            <Paragraph>Inherits italic.</Paragraph>
          </DefaultTextStyle>
        </Page>
      </Document>,
    );
  });

  it("layout: rows, boxes, padding, flex, spacer, divider", async () => {
    await same(
      tsDoc([
        pdf.Row({ gap: 8 }, [
          pdf.Expanded({ flex: 2 }, pdf.Box({ bg: "#eef", padding: 6 }, [pdf.Text("wide")])),
          pdf.Spacer(),
          pdf.Box({ width: "30%", border: "#333", radius: 4 }, [pdf.Text("box")]),
        ]),
        pdf.Divider({ color: "#ccc" }),
        pdf.Padding({ left: 10 }, pdf.Text("indented")),
        pdf.Column({ gap: 4, align: "center" }, [pdf.Text("a"), pdf.Text("b")]),
      ]),
      jsxDoc(
        <>
          <Row gap={8}>
            <Expanded flex={2}>
              <Box bg="#eef" padding={6}>
                <Text>wide</Text>
              </Box>
            </Expanded>
            <Spacer />
            <Box width="30%" border="#333" radius={4}>
              <Text>box</Text>
            </Box>
          </Row>
          <Divider color="#ccc" />
          <Padding insets={{ left: 10 }}>
            <Text>indented</Text>
          </Padding>
          <Column gap={4} align="center">
            <Text>a</Text>
            <Text>b</Text>
          </Column>
        </>,
      ),
    );
  });

  it("header, footer, page numbers, page break, keep-together", async () => {
    const header = pdf.Text("Report", { bold: true });
    await same(
      tsDoc(
        [pdf.Text("one"), pdf.PageBreak(), pdf.keepTogether([pdf.Text("two"), pdf.Text("three")])],
        {
          header,
          footer: pdf.Row([
            pdf.PageNumber({ size: 8 }),
            pdf.Text(" / "),
            pdf.PageCount({ size: 8 }),
          ]),
        },
      ),
      jsxDoc(
        <>
          <Text>one</Text>
          <PageBreak />
          <KeepTogether>
            <Text>two</Text>
            <Text>three</Text>
          </KeepTogether>
        </>,
        {
          header: <Text bold>Report</Text>,
          footer: (
            <Row>
              <PageNumber size={8} />
              <Text> / </Text>
              <PageCount size={8} />
            </Row>
          ),
        },
      ),
    );
  });

  it("table with a repeating header row", async () => {
    await same(
      tsDoc([
        pdf.Table({ columns: ["auto", "1fr"], cellBorder: "#ccc", header: ["Item", "Qty"] }, [
          ["Pen", "3"],
          [pdf.Text("Ink", { bold: true }), "1"],
        ]),
      ]),
      jsxDoc(
        <Table columns={["auto", "1fr"]} cellBorder="#ccc">
          <TableRow header>
            <TableCell>Item</TableCell>
            <TableCell>Qty</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Pen</TableCell>
            <TableCell>3</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>
              <Text bold>Ink</Text>
            </TableCell>
            <TableCell>1</TableCell>
          </TableRow>
        </Table>,
      ),
    );
  });

  it("positioned, rotated, navigation", async () => {
    await same(
      tsDoc([
        pdf.Box({ relative: true, padding: 12 }, [
          pdf.Text("body"),
          pdf.Positioned({ top: -6, right: -6, zIndex: 1 }, pdf.Text("NEW", { size: 8 })),
        ]),
        pdf.Rotated({ angle: -12 }, pdf.Text("PAID")),
        pdf.RotatedBox({ turns: 1 }, pdf.Text("side")),
        pdf.Bookmark({ title: "Start" }, pdf.Anchor({ name: "start" }, pdf.Text("Start"))),
        pdf.Link({ href: "https://jasy.dev" }, pdf.Text("jasy.dev")),
        pdf.Link({ to: "start" }, pdf.Text("back")),
      ]),
      jsxDoc(
        <>
          <Box relative padding={12}>
            <Text>body</Text>
            <Positioned top={-6} right={-6} zIndex={1}>
              <Text size={8}>NEW</Text>
            </Positioned>
          </Box>
          <Rotated angle={-12}>
            <Text>PAID</Text>
          </Rotated>
          <RotatedBox turns={1}>
            <Text>side</Text>
          </RotatedBox>
          <Bookmark title="Start">
            <Anchor name="start">
              <Text>Start</Text>
            </Anchor>
          </Bookmark>
          <Link href="https://jasy.dev">
            <Text>jasy.dev</Text>
          </Link>
          <Link to="start">
            <Text>back</Text>
          </Link>
        </>,
      ),
    );
  });

  it("image, svg and canvas", async () => {
    const paint: pdf.CanvasPaint = (p, size) => p.rect(0, 0, size.width, size.height).fill("teal");
    const png = new Uint8Array(readFileSync(new URL("./fixtures/logo.png", import.meta.url)));
    await same(
      tsDoc([
        pdf.Image(png, { width: 30, height: 60, fit: "contain", align: "end" }),
        pdf.Svg(SVG, { width: 40 }),
        pdf.Canvas({ width: 50, height: 20 }, paint),
      ]),
      jsxDoc(
        <>
          <Image src={png} width={30} height={60} fit="contain" align="end" />
          <Svg src={SVG} width={40} />
          <Canvas width={50} height={20} paint={paint} />
        </>,
      ),
    );
  });

  it("form fields, labels written as children", async () => {
    await same(
      tsDoc([
        pdf.TextField({ name: "email", width: 160 }),
        pdf.Checkbox({ name: "terms", label: "I agree to 2 terms" }),
        pdf.RadioGroup({ name: "size" }, [
          { value: "S", label: "S" },
          { value: "M", label: "Medium" },
        ]),
        pdf.Dropdown({ name: "country" }, ["DE", { value: "AT", label: "Austria" }]),
        pdf.ListBox({ name: "tags", height: 40 }, ["a", "b"]),
        pdf.PushButton({ name: "reset", label: "Reset", action: "reset" }),
        pdf.SignatureField({ name: "sig", label: "Signature" }),
      ]),
      jsxDoc(
        <>
          <TextField name="email" width={160} />
          <Checkbox name="terms">I agree to {2} terms</Checkbox>
          <RadioGroup name="size" options={["S", { value: "M", label: "Medium" }]} />
          <Dropdown name="country" options={["DE", { value: "AT", label: "Austria" }]} />
          <ListBox name="tags" height={40} options={["a", "b"]} />
          <PushButton name="reset" action="reset">
            Reset
          </PushButton>
          <SignatureField name="sig" label="Signature" />
        </>,
      ),
    );
  });
});

describe("React itself works inside a document", () => {
  it("hooks, context and lists with keys", async () => {
    const Theme = createContext("#000");
    const Heading = ({ children }: { children: string }) => {
      const color = useContext(Theme);
      const [size] = useState(18);
      return (
        <Text size={size} color={color}>
          {children}
        </Text>
      );
    };
    const items = ["Pen", "Ink"];
    await same(
      tsDoc([pdf.Text("Order", { size: 18, color: "#1450aa" }), pdf.Text("Pen"), pdf.Text("Ink")]),
      jsxDoc(
        <Theme.Provider value="#1450aa">
          <Heading>Order</Heading>
          {items.map((item) => (
            <Text key={item}>{item}</Text>
          ))}
          {false}
          {null}
        </Theme.Provider>,
      ),
    );
  });

  it("an error thrown in a component rejects the render", async () => {
    const Broken = (): ReactNode => {
      throw new Error("no data");
    };
    await expect(renderToPdf(jsxDoc(<Broken />))).rejects.toThrow("no data");
  });

  it("an element without a <Document> is refused by name", async () => {
    await expect(renderToPdf(<Text>loose</Text>)).rejects.toThrow("must render a <Document>");
  });

  it("renders to the raw PDF string and to a serializable descriptor", async () => {
    expect((await renderToPdfString(jsxDoc(<Text>hi</Text>))).startsWith("%PDF-")).toBe(true);
    const descriptor = toDocumentDescriptor(jsxDoc(<Text bold>hi</Text>));
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual({
      type: "document",
      props: {},
      children: [
        {
          type: "page",
          props: { size: SIZE, margin: 20 },
          children: [{ type: "text", props: { bold: true }, children: ["hi"] }],
        },
      ],
    });
  });
});

describe("<Flow page={...}>", () => {
  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => `${i + 1}. A line of content that flows on.`);

  it("draws what the same Flow in TypeScript draws, page for page", async () => {
    await same(
      tsDoc([
        pdf.Flow(
          {
            gap: 4,
            template: ({ index }) =>
              pdf.Row({ gap: 12 }, [
                pdf.Expanded(pdf.Region()),
                index === 0 ? pdf.Expanded(pdf.Region()) : pdf.Region({ width: 60 }),
              ]),
          },
          [...lines(30).map((l) => pdf.Text(l)), pdf.ColumnBreak(), pdf.Text("after")],
        ),
      ]),
      jsxDoc(
        <Flow
          gap={4}
          page={({ index }) => (
            <Row gap={12}>
              <Expanded>
                <Region />
              </Expanded>
              {index === 0 ? (
                <Expanded>
                  <Region />
                </Expanded>
              ) : (
                <Region width={60} />
              )}
            </Row>
          )}
        >
          {lines(30).map((l) => (
            <Text key={l}>{l}</Text>
          ))}
          <ColumnBreak />
          <Text>after</Text>
        </Flow>,
      ),
    );
  });

  it("sees the context around it while it renders a page", async () => {
    const Gap = createContext(0);
    const Columns = () => {
      const gap = useContext(Gap);
      return (
        <Row gap={gap}>
          <Expanded>
            <Region />
          </Expanded>
          <Expanded>
            <Region />
          </Expanded>
        </Row>
      );
    };
    await same(
      tsDoc([
        pdf.SplitView(
          { columns: 2, gap: 30, balance: false },
          lines(20).map((l) => pdf.Text(l)),
        ),
      ]),
      jsxDoc(
        <SplitView columns={2} gap={30} balance={false}>
          {lines(20).map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </SplitView>,
      ),
    );
    const viaContext = await renderToPdf(
      jsxDoc(
        <Gap.Provider value={30}>
          <Flow page={() => <Columns />}>
            {lines(20).map((l) => (
              <Text key={l}>{l}</Text>
            ))}
          </Flow>
        </Gap.Provider>,
      ),
    );
    const direct = await pdf.renderToBytes(
      tsDoc([
        pdf.Flow(
          {
            template: () =>
              pdf.Row({ gap: 30 }, [pdf.Expanded(pdf.Region()), pdf.Expanded(pdf.Region())]),
          },
          lines(20).map((l) => pdf.Text(l)),
        ),
      ]),
    );
    expect(Buffer.from(viaContext).equals(Buffer.from(direct))).toBe(true);
  });

  it("an error thrown in a page rejects the render", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = (): ReactNode => {
      throw new Error("bad page");
    };
    await expect(
      renderToPdf(
        jsxDoc(
          <Flow page={() => <Broken />}>
            <Text>content</Text>
          </Flow>,
        ),
      ),
    ).rejects.toThrow("bad page");
    error.mockRestore();
  });

  it("names the fix when its document was only turned into a descriptor", () => {
    const descriptor = toDocumentDescriptor(
      jsxDoc(
        <Flow page={() => <Region />}>
          <Text>content</Text>
        </Flow>,
      ),
    );
    const flow = (descriptor.children![0] as pdf.Descriptor).children![0] as pdf.Descriptor;
    expect(() => flow.props!.page({ index: 0 })).toThrow("render the document with renderToPdf");
  });
});

describe("<PageBuilder>{(info) => ...}</PageBuilder>", () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the body.`);

  it("builds each page's footer like the TypeScript PageBuilder", async () => {
    await same(
      tsDoc(
        body(40).map((l) => pdf.Text(l)),
        {
          footer: pdf.PageBuilder(({ pageNumber, pageCount }) =>
            pdf.Text(`Page ${pageNumber} of ${pageCount}`, { size: 8 }),
          ),
        },
      ),
      jsxDoc(
        body(40).map((l) => <Text key={l}>{l}</Text>),
        {
          footer: (
            <PageBuilder>
              {({ pageNumber, pageCount }) => (
                <Text size={8}>
                  Page {pageNumber} of {pageCount}
                </Text>
              )}
            </PageBuilder>
          ),
        },
      ),
    );
  });

  it("builds nothing where it returns null, and sees the context around it", async () => {
    const Accent = createContext("#000");
    await same(
      tsDoc(
        body(40).map((l) => pdf.Text(l)),
        {
          header: pdf.PageBuilder(({ pageNumber }) =>
            pageNumber === 1 ? pdf.Column([]) : pdf.Text("continued", { color: "#1450aa" }),
          ),
        },
      ),
      <Accent.Provider value="#1450aa">
        {jsxDoc(
          body(40).map((l) => <Text key={l}>{l}</Text>),
          {
            header: (
              <PageBuilder>
                {({ pageNumber }) =>
                  pageNumber === 1 ? null : (
                    <Accent.Consumer>
                      {(color) => <Text color={color}>continued</Text>}
                    </Accent.Consumer>
                  )
                }
              </PageBuilder>
            ),
          },
        )}
      </Accent.Provider>,
    );
  });

  it("counts within each Page with SubPageNumber and SubPageCount", async () => {
    const tsFooter = pdf.Row([
      pdf.SubPageNumber({ size: 8 }),
      pdf.Text("/"),
      pdf.SubPageCount({ size: 8 }),
    ]);
    const jsxFooter = (
      <Row>
        <SubPageNumber size={8} />
        <Text>/</Text>
        <SubPageCount size={8} />
      </Row>
    );
    const opts = { size: SIZE, margin: 20 };
    await same(
      pdf.Document([
        pdf.Page(
          { ...opts, footer: tsFooter },
          body(30).map((l) => pdf.Text(l)),
        ),
        pdf.Page(
          { ...opts, footer: tsFooter },
          body(10).map((l) => pdf.Text(l)),
        ),
      ]),
      <Document>
        <Page {...opts} footer={jsxFooter}>
          {body(30).map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </Page>
        <Page {...opts} footer={jsxFooter}>
          {body(10).map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </Page>
      </Document>,
    );
  });

  it("inside a Flow's page, draws what that page rendered", async () => {
    await same(
      tsDoc([
        pdf.Flow(
          {
            template: ({ index }) =>
              pdf.Column({ gap: 4 }, [
                pdf.PageBuilder(({ pageNumber }) =>
                  pdf.Text(`part ${index + 1}, sheet ${pageNumber}`),
                ),
                pdf.Region(),
              ]),
          },
          body(40).map((l) => pdf.Text(l)),
        ),
      ]),
      jsxDoc(
        <Flow
          page={({ index }) => (
            <Column gap={4}>
              <PageBuilder>
                {({ pageNumber }) => <Text>{`part ${index + 1}, sheet ${pageNumber}`}</Text>}
              </PageBuilder>
              <Region />
            </Column>
          )}
        >
          {body(40).map((l) => (
            <Text key={l}>{l}</Text>
          ))}
        </Flow>,
      ),
    );
  });
});
