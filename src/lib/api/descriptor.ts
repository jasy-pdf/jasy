import { PDFElement } from "../elements/pdf-element.ts";
import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import { PageElement } from "../elements/page-element.ts";
import { TextSegment } from "../elements/text-element.ts";
import { Text, Paragraph, span } from "./text.ts";
import { Column, Row, Box, Padding, Spacer, Expanded } from "./layout.ts";
import { Divider, Image } from "./content.ts";
import { Page, Document } from "./structure.ts";

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

const REGISTRY: Record<string, ElementFactory> = {
  document: (props, children) => {
    const doc = Document(props, elementChildren(children) as PageElement[]);
    // A binding can register fonts declaratively: `fonts: { Name: bytes | path | family }`.
    if (props.fonts) {
      for (const [name, src] of Object.entries(props.fonts)) doc.addFont(name, src as any);
    }
    return doc;
  },
  page: (props, children) => Page(props, elementChildren(children)),
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
