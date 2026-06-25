import { PDFElement } from "../elements/pdf-element.ts";
import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import { PageElement } from "../elements/page-element.ts";
import { TextSegment } from "../elements/text-element.ts";
import { Text, Paragraph, span } from "./text.ts";
import { Column, Row, Box, Padding, Spacer, Expanded, Positioned } from "./layout.ts";
import { Divider, Image } from "./content.ts";
import { Page, Document, DefaultTextStyle } from "./structure.ts";
import { Table, Cell } from "./table.ts";

/**
 * The framework-agnostic contract (the firewall). A binding (Vue/React, or any tree-builder)
 * produces a tree of these plain descriptors; `build` turns each node into an engine element
 * through the SAME factories the programmatic API uses - one mapping, shared by every binding.
 */
export interface Descriptor {
  type: string;
  props?: Record<string, any>;
  children?: DescriptorChild[];
}
export type DescriptorChild = Descriptor | string;

/** A registry entry: turn a node's props + raw children into an engine element. */
export type ElementFactory = (props: any, children: DescriptorChild[]) => PDFElement;

// Element children (Column/Row/Box/Page/…) → built recursively. Text/Paragraph children are
// strings or `span` descriptors and become content instead.
function elementChildren(children: DescriptorChild[]): PDFElement[] {
  return children.map(build);
}

function textOf(node: DescriptorChild): string {
  if (typeof node === "string") return node;
  const first = node.children?.[0];
  return typeof first === "string" ? first : "";
}

function toSegment(c: DescriptorChild): TextSegment {
  if (typeof c === "string") return span(c);
  if (c.type === "span") return span(textOf(c), c.props);
  throw new Error(`A Text child must be a string or a span, got "${c.type}"`);
}

function textContent(children: DescriptorChild[]): string | TextSegment[] {
  if (children.length === 1 && typeof children[0] === "string") return children[0];
  return children.map(toSegment);
}

// A `<TableCell>`'s content → a `Cell`: a lone string stays a string (the table wraps it in Text);
// otherwise its children are built (a single element, or a Column of several).
function buildCell(cell: DescriptorChild): Cell {
  if (typeof cell === "string") return cell;
  const kids = cell.children ?? [];
  if (kids.length === 1 && typeof kids[0] === "string") return kids[0];
  if (kids.length === 0) return "";
  const els = kids.map(build);
  return els.length === 1 ? els[0] : Column(els);
}

// A `<TableRow>`'s `<TableCell>` children → one row of `Cell`s.
function rowCells(row: Descriptor): Cell[] {
  return (row.children ?? [])
    .filter((c): c is Descriptor => typeof c !== "string" && c.type === "table-cell")
    .map(buildCell);
}

// A `#header` / `#footer` slot's content → one element (a Column if it holds several; strings → Text).
function slotElement(node: Descriptor): PDFElement {
  const els = (node.children ?? []).map((c) => (typeof c === "string" ? Text(c) : build(c)));
  return els.length === 1 ? els[0] : Column(els);
}

const REGISTRY: Record<string, ElementFactory> = {
  document: (props, children) => {
    const doc = Document(props, elementChildren(children) as PageElement[]);
    // A binding can register fonts declaratively: `fonts: { Name: bytes | path | family }`.
    if (props.fonts) {
      for (const [name, src] of Object.entries(props.fonts)) doc.addFont(name, src as any);
    }
    return doc;
  },
  page: (props, children) => {
    // `#header` / `#footer` arrive as `page-header` / `page-footer` marker children (read raw); the rest
    // is the body. Both repeat on every physical page the body paginates onto.
    const slot = (type: string) => {
      const m = children.find((c): c is Descriptor => typeof c !== "string" && c.type === type);
      return m ? slotElement(m) : undefined;
    };
    const body = children.filter(
      (c) => typeof c === "string" || (c.type !== "page-header" && c.type !== "page-footer"),
    );
    return Page(
      { ...props, header: slot("page-header"), footer: slot("page-footer") },
      elementChildren(body),
    );
  },
  column: (props, children) => Column(props, elementChildren(children)),
  row: (props, children) => Row(props, elementChildren(children)),
  box: (props, children) => Box(props, elementChildren(children)),
  padding: (props, children) => Padding(props.insets ?? 0, elementChildren(children)[0]),
  expanded: (props, children) => Expanded(props, elementChildren(children)[0]),
  spacer: (props) => Spacer(props?.flex),
  divider: (props) => Divider(props),
  image: (props) => Image(props.src, props),
  text: (props, children) => Text(textContent(children), props),
  paragraph: (props, children) => Paragraph(textContent(children), props),
  // `<Table>` reads its `<TableRow>`/`<TableCell>` structure raw; one row may be marked `header`.
  table: (props, children) => {
    const rows = children.filter(
      (c): c is Descriptor => typeof c !== "string" && c.type === "table-row",
    );
    const header = rows.find((r) => r.props?.header);
    const body = rows.filter((r) => !r.props?.header);
    return Table({ ...props, header: header ? rowCells(header) : undefined }, body.map(rowCells));
  },
  positioned: (props, children) => Positioned(props, elementChildren(children)[0]),
  "default-text-style": (props, children) => DefaultTextStyle(props, elementChildren(children)),
};

/**
 * Registers a custom element type, so a binding (or a user-defined component) can introduce
 * its own tag that resolves to an engine element through this same seam. Overwrites an
 * existing type of the same name.
 */
export function registerElement(type: string, factory: ElementFactory): void {
  REGISTRY[type] = factory;
}

/** Turns one descriptor node (or bare string → `Text`) into an engine element. */
export function build(node: DescriptorChild): PDFElement {
  if (typeof node === "string") return Text(node);
  const factory = REGISTRY[node.type];
  if (!factory) throw new Error(`Unknown element type: "${node.type}"`);
  return factory(node.props ?? {}, node.children ?? []);
}

/** Builds a descriptor tree whose root is a `document` into the renderable root element. */
export function buildDocument(root: Descriptor): PDFDocumentElement {
  if (root.type !== "document") throw new Error(`Expected a "document" root, got "${root.type}"`);
  return build(root) as PDFDocumentElement;
}
