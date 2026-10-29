/**
 * What the engine tells the author about a document it rendered anyway - one channel for every such
 * signal, so an application (or an agent, which cannot see the page) can act on it by `code`.
 *
 * Without a handler nothing changes: what warned before still goes to `console.warn`, what was silent
 * stays silent. A handler receives everything, once per element and code - layout runs several times
 * per render, and the same mistake must not be reported for each pass.
 */

export type DiagnosticCode =
  /** A `PageBreak` outside a paginating flow (in a Row, in a PageBuilder) - drawn as nothing. */
  | "page-break-ignored"
  /** A `ColumnBreak` outside a Region of a Flow - drawn as nothing. */
  | "column-break-ignored"
  /** `breakBefore` / `breakAfter` on a child of a Row or a table row, which never breaks. */
  | "break-ignored"
  /** A `keepTogether` group contains a forced break; the break wins and the group is split. */
  | "keep-together-split"
  /** Content taller than its page region that cannot break, placed whole and clipped. */
  | "overflow-clipped"
  /** Content wider than its box (a word that does not break, a Row whose children need more), drawn
   *  past the box's edge - as CSS draws it; `overflow: "hidden"` on a Box clips it. */
  | "overflow-wide"
  /** Characters no font could draw, removed (PDF/A forbids `.notdef`). */
  | "missing-glyphs";

export interface Diagnostic {
  code: DiagnosticCode;
  severity: "warning" | "info";
  message: string;
  /** The kind of element it is about, by the factory name an author writes: `"Row"`, `"Box"`, `"Text"`. */
  element?: string;
  /** The first text inside that element, shortened - so the place can be found in the document. */
  text?: string;
  /** The 1-based page, when the element is being laid out on a known page. */
  page?: number;
}

export type DiagnosticHandler = (diagnostic: Diagnostic) => void;

/** Whether a diagnostic goes to `console.warn` when no handler is set - only what warned before. */
type Fallback = "warn" | "silent";

const EXCERPT = 40;

/** Engine classes whose factory carries another name. */
const FACTORY: Record<string, string> = { Rectangle: "Box", Container: "Column" };

export class Diagnostics {
  private handler?: DiagnosticHandler;
  private readonly seen = new WeakMap<object, Set<DiagnosticCode>>();

  setHandler(handler: DiagnosticHandler | undefined): void {
    this.handler = handler;
  }

  /** Report once per `about` and code. `about` is the element the message is about, or any key. */
  report(d: Omit<Diagnostic, "element" | "text"> & { about?: object; fallback?: Fallback }): void {
    const { about, fallback = "warn", ...rest } = d;
    if (about) {
      const codes = this.seen.get(about) ?? new Set<DiagnosticCode>();
      if (codes.has(rest.code)) return;
      codes.add(rest.code);
      this.seen.set(about, codes);
    }
    const diagnostic: Diagnostic = { ...rest, ...(about ? describe(about) : {}) };
    if (this.handler) this.handler(diagnostic);
    else if (fallback === "warn") console.warn(diagnostic.message);
  }
}

/** The element's kind and the first text inside it, from what every element exposes. */
function describe(about: object): { element?: string; text?: string } {
  const name = about.constructor?.name;
  if (!name || name === "Object") return {};
  const text = firstText(about, 0);
  const kind = name.replace(/Element$/, "");
  return {
    element: FACTORY[kind] ?? kind,
    ...(text ? { text: text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text } : {}),
  };
}

interface Walkable {
  getProps?: () => { content?: unknown };
  layoutChildren?: () => readonly object[];
}

function firstText(el: object, depth: number): string | undefined {
  if (depth > 32) return undefined;
  const node = el as Walkable;
  if (node.constructor?.name === "TextElement") {
    const content = node.getProps?.().content;
    const s =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c: { content?: string }) => c.content ?? "").join("")
          : "";
    return s.replace(/\s+/g, " ").trim() || undefined;
  }
  for (const child of node.layoutChildren?.() ?? []) {
    const t = firstText(child, depth + 1);
    if (t) return t;
  }
  return undefined;
}

/** The 1-based page a layout context is on, as far as it knows: drawn (`pageInfo`) or being paginated. */
export function pageOf(ctx: { pageInfo?: { pageNumber: number }; paginatingPage?: number }) {
  return ctx.pageInfo?.pageNumber ?? ctx.paginatingPage;
}

/** Outside a render (an element laid out on its own) there is no document channel: warn, once each. */
const bare = new Diagnostics();

/** Report through the render's channel, or - laid out on its own - warn as before. */
export function diagnose(
  diagnostics: Diagnostics | undefined,
  d: Parameters<Diagnostics["report"]>[0],
): void {
  (diagnostics ?? bare).report(d);
}
