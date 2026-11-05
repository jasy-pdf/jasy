import Reconciler from "react-reconciler";
import { DefaultEventPriority, LegacyRoot } from "react-reconciler/constants.js";
import { createContext, createElement, type ReactNode } from "react";
import type { Descriptor, DescriptorChild } from "@jasy/pdf";

/**
 * A host node in our tree. It is shaped like a `Descriptor` already: the reconciler builds this tree,
 * and it maps 1:1 onto the engine's descriptor seam. Text nodes carry `text`; `parent` is bookkeeping
 * the reconciler needs (insert/remove), stripped on the way out.
 */
export interface JNode {
  type: string;
  props: Record<string, any>;
  children: JNode[];
  text?: string;
  parent: JNode | null;
}

const node = (type: string, props: Record<string, any> = {}): JNode => ({
  type,
  props,
  children: [],
  parent: null,
});

// `children` and `ref` are React's, not props the engine reads - the tree carries the children.
function ownProps({
  children: _children,
  ref: _ref,
  ...rest
}: Record<string, any>): Record<string, any> {
  return rest;
}

function insert(parent: JNode, child: JNode, before?: JNode): void {
  detach(child);
  child.parent = parent;
  const i = before ? parent.children.indexOf(before) : -1;
  if (i >= 0) parent.children.splice(i, 0, child);
  else parent.children.push(child);
}

function detach(child: JNode): void {
  const siblings = child.parent?.children;
  const i = siblings?.indexOf(child) ?? -1;
  if (siblings && i >= 0) siblings.splice(i, 1);
  child.parent = null;
}

let updatePriority: number = DefaultEventPriority;

// The host config, as react-reconciler 0.31 (React 19) calls it - see react-reconciler.d.ts.
const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  supportsMicrotasks: true,
  scheduleMicrotask: queueMicrotask,

  createInstance: (type: string, props: Record<string, any>) => node(type, ownProps(props)),
  createTextInstance: (text: string) => Object.assign(node("#text"), { text }),
  appendInitialChild: insert,
  appendChild: insert,
  appendChildToContainer: insert,
  insertBefore: insert,
  insertInContainerBefore: insert,
  removeChild: (_parent: JNode, child: JNode) => detach(child),
  removeChildFromContainer: (_parent: JNode, child: JNode) => detach(child),
  clearContainer: (container: JNode) => {
    container.children = [];
  },
  commitUpdate: (n: JNode, _type: string, _prev: unknown, next: Record<string, any>) => {
    n.props = ownProps(next);
  },
  commitTextUpdate: (n: JNode, _prev: string, next: string) => {
    n.text = next;
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parent: object) => parent,
  getPublicInstance: (n: JNode) => n,
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  preparePortalMount: () => {},
  detachDeletedInstance: () => {},
  hideInstance: () => {},
  unhideInstance: () => {},
  hideTextInstance: () => {},
  unhideTextInstance: () => {},

  // Scheduling: a PDF is rendered in one synchronous pass, there are no events to prioritize.
  getCurrentEventPriority: () => DefaultEventPriority,
  getCurrentUpdatePriority: () => updatePriority,
  setCurrentUpdatePriority: (p: number) => {
    updatePriority = p;
  },
  resolveUpdatePriority: () => updatePriority,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  requestPostPaintCallback: () => {},
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance: () => {},
};

const reconciler = Reconciler(hostConfig);

/** Where a render reports an error thrown in the tree - also while a `Flow` re-renders its page. */
export interface RenderSink {
  failure?: unknown;
}
export const RenderSinkContext = createContext<RenderSink | null>(null);

// Text and Paragraph read their children as text, so whitespace there is content (`{" "}` between two
// spans). Everywhere else a whitespace-only string would become an empty Text with a stray `gap`.
const TEXT_PARENTS = new Set(["text", "paragraph", "span"]);

/** Strip our tree down to the engine's descriptor: adjacent strings merge, empty ones are dropped. */
function toDescriptor(n: JNode): DescriptorChild {
  if (n.type === "#text") return n.text ?? "";
  return { type: n.type, props: n.props, children: childDescriptors(n) };
}

/**
 * A node's children as descriptors - also what a `Flow` reads its rendered page from. `Total: {sum}` is
 * two text nodes in React; merged back into one string they measure and kern as the one run they are.
 */
export function childDescriptors(n: JNode): DescriptorChild[] {
  const out: DescriptorChild[] = [];
  for (const c of n.children) {
    const d = toDescriptor(c);
    const last = out[out.length - 1];
    if (typeof d === "string" && typeof last === "string") out[out.length - 1] = last + d;
    else out.push(d);
  }
  return TEXT_PARENTS.has(n.type)
    ? out.filter((d) => d !== "")
    : out.filter((d) => typeof d !== "string" || d.trim() !== "");
}

/**
 * Mounts an element and returns the engine descriptor for its `<Document>` root, with the tree still
 * mounted: a `Flow` renders its `page` for every page while the engine lays the document out.
 */
export function mountDocument(element: ReactNode): { descriptor: Descriptor; unmount: () => void } {
  const container = node("#root");
  const sink: RenderSink = {};
  // An error no boundary caught fails the render; one a boundary caught is the author's to handle.
  const fail = (error: unknown) => {
    sink.failure ??= error;
  };
  const report = (error: unknown) => console.error(error);
  const root = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    "",
    fail,
    report,
    report,
    null,
  );
  const unmount = () => {
    reconciler.updateContainerSync(null, root, null, null);
    reconciler.flushSyncWork();
  };
  reconciler.updateContainerSync(
    createElement(RenderSinkContext.Provider, { value: sink }, element),
    root,
    null,
    null,
  );
  reconciler.flushSyncWork();
  if (sink.failure) {
    unmount();
    throw sink.failure;
  }
  const doc = container.children.find((c) => c.type === "document");
  if (!doc) {
    unmount();
    throw new Error("@jasy/react: the element must render a <Document>.");
  }
  return { descriptor: toDescriptor(doc) as Descriptor, unmount };
}

/** Synchronously apply a state update made outside React's render, so its result can be read back. */
export function flushNow(update: () => void): void {
  reconciler.flushSyncFromReconciler(update);
  reconciler.flushSyncWork();
}
