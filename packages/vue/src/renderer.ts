import { createRenderer, type Component } from "vue";
import type { Descriptor, DescriptorChild } from "@jasy/pdf";

/**
 * A host node in our tree. It is shaped like a `Descriptor` already - that is the whole trick: Vue's
 * custom renderer builds this tree, and it maps 1:1 onto the engine's descriptor seam. Text nodes carry
 * `text`; `parent` is bookkeeping the renderer needs (insert/remove/sibling), stripped on the way out.
 *
 * This module is browser-safe on purpose: it never imports the Node engine (only the `Descriptor` type,
 * which is erased). So a browser can turn a component into a descriptor and post it to a Node renderer.
 */
interface JNode {
  type: string;
  props: Record<string, any>;
  children: JNode[];
  text?: string;
  parent: JNode | null;
}

const node = (type: string): JNode => ({ type, props: {}, children: [], parent: null });

// The custom renderer: nodeOps that build the JNode tree instead of touching a DOM.
const { createApp } = createRenderer<JNode, JNode>({
  createElement: (type) => node(type),
  createText: (text) => Object.assign(node("#text"), { text }),
  createComment: () => node("#comment"),
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (n, text) => {
    n.children = [Object.assign(node("#text"), { text })];
  },
  insert: (child, parent, anchor) => {
    child.parent = parent;
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i >= 0) parent.children.splice(i, 0, child);
    else parent.children.push(child);
  },
  remove: (child) => {
    const siblings = child.parent?.children;
    const i = siblings?.indexOf(child) ?? -1;
    if (siblings && i >= 0) siblings.splice(i, 1);
  },
  patchProp: (n, key, _prev, next) => {
    n.props[key] = next;
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const siblings = n.parent?.children;
    if (!siblings) return null;
    return siblings[siblings.indexOf(n) + 1] ?? null;
  },
});

/** Strip our tree down to the engine's descriptor: text nodes become strings, comments are dropped. */
function toDescriptor(n: JNode): DescriptorChild {
  if (n.type === "#text") return n.text ?? "";
  return {
    type: n.type,
    props: n.props,
    // Drop comments AND whitespace-only text nodes: Vue inserts empty `#text` anchors around lists
    // (`v-for`) and templates leave whitespace between tags. As layout children each would become a
    // 0-height empty Text that still gets a stray `gap` in its parent Column/Row - which silently
    // inflates the height and can force a spurious extra page. Real text content is never whitespace.
    children: n.children
      .filter((c) => c.type !== "#comment" && !(c.type === "#text" && (c.text ?? "").trim() === ""))
      .map(toDescriptor),
  };
}

/**
 * Mounts a component once (one-shot - a PDF is not interactive) and returns the engine descriptor for
 * its `<Document>` root. The descriptor is a plain serialisable object, so it can be posted to a Node
 * renderer from the browser, or handed straight to `renderToPdf` (from `@jasy/vue/node`) on the server.
 */
export function toDocumentDescriptor(root: Component, props?: Record<string, any>): Descriptor {
  const container = node("#root");
  const app = createApp(root, props ?? null);
  app.mount(container);
  const doc = container.children.find((c) => c.type === "document");
  app.unmount();
  if (!doc) throw new Error("@jasy/vue: the root component must render a <Document>.");
  return toDescriptor(doc) as Descriptor;
}
