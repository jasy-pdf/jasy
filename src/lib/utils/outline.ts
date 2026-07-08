import type { PDFObjectManager } from "./pdf-object-manager.ts";

// A PDF literal string escape (same rule as elsewhere): backslash first, then the string delimiters.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n: number) => Number(n.toFixed(2));

// One bookmark, collected in document (reading) order as pages render. `top` is the page-space
// (already Y-flipped) y of the target, `pageObjNum` the page's indirect object it lives on.
interface Entry {
  title: string;
  level: number;
  pageObjNum: number;
  top: number;
}

// One node of the built outline tree (an Entry plus its resolved position in the hierarchy).
interface Node extends Entry {
  children: Node[];
}

/**
 * Builds the PDF document outline (`/Outlines`) - the viewer's bookmark panel. Entries are collected
 * flat in reading order with a 1-based `level`; `finalize` nests each entry under the nearest preceding
 * entry of a smaller level (so level 2s hang under the last level 1), emits the outline objects and
 * returns the catalog addition `/Outlines N 0 R`. A no-op returning "" when nothing was added, so a
 * document without bookmarks stays byte-identical.
 */
export class OutlineBuilder {
  private entries: Entry[] = [];

  add(entry: Entry): void {
    this.entries.push(entry);
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  finalize(om: PDFObjectManager): string {
    if (this.entries.length === 0) return "";

    // Nest by level: a stack where stack[i] is the last open node at level i+1. An entry at level L
    // becomes a child of stack[L-2] (the enclosing smaller level), or a root when L is 1. Levels that
    // skip a step (1 -> 3) are clamped to one deeper than the current stack so nothing is orphaned.
    const roots: Node[] = [];
    const stack: Node[] = [];
    for (const e of this.entries) {
      const level = Math.max(1, Math.min(e.level, stack.length + 1));
      stack.length = level - 1; // pop back to this entry's parent depth
      const node: Node = { ...e, children: [] };
      if (level === 1) roots.push(node);
      else stack[level - 2].children.push(node);
      stack[level - 1] = node;
    }

    // Reserve an object number for every node up front - parent/child/prev/next all cross-reference.
    const objOf = new Map<Node, number>();
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        objOf.set(n, om.addObject(""));
        walk(n.children);
      }
    };
    walk(roots);
    const rootNum = om.addObject(""); // the /Outlines dictionary itself

    // Count of all descendants of a node (used for the /Count of an open item, which shows them all).
    const descendantCount = (n: Node): number =>
      n.children.reduce((sum, c) => sum + 1 + descendantCount(c), 0);
    const totalCount = roots.reduce((sum, r) => sum + 1 + descendantCount(r), 0);

    // Emit each item dict, wired to its parent, siblings (prev/next) and first/last child.
    const emit = (nodes: Node[], parentNum: number) => {
      nodes.forEach((n, i) => {
        const parts = [`/Title (${esc(n.title)})`, `/Parent ${parentNum} 0 R`];
        if (i > 0) parts.push(`/Prev ${objOf.get(nodes[i - 1])!} 0 R`);
        if (i < nodes.length - 1) parts.push(`/Next ${objOf.get(nodes[i + 1])!} 0 R`);
        if (n.children.length > 0) {
          parts.push(`/First ${objOf.get(n.children[0])!} 0 R`);
          parts.push(`/Last ${objOf.get(n.children[n.children.length - 1])!} 0 R`);
          parts.push(`/Count ${descendantCount(n)}`); // positive = shown open
        }
        // /Dest: jump to this page, scrolling the target's top into view; null left/zoom keep the
        // viewer's current horizontal position and magnification. Guard the top: a non-finite value
        // (e.g. a bookmark under a Spacer in an unbounded column) would emit invalid PDF, so fall back
        // to the page top (0 flips to the page top edge).
        const top = Number.isFinite(n.top) ? num(n.top) : 0;
        parts.push(`/Dest [${n.pageObjNum} 0 R /XYZ null ${top} null]`);
        om.replaceObject(objOf.get(n)!, `<< ${parts.join(" ")} >>`);
        emit(n.children, objOf.get(n)!);
      });
    };
    emit(roots, rootNum);

    om.replaceObject(
      rootNum,
      `<< /Type /Outlines /First ${objOf.get(roots[0])!} 0 R ` +
        `/Last ${objOf.get(roots[roots.length - 1])!} 0 R /Count ${totalCount} >>`,
    );

    return `/Outlines ${rootNum} 0 R`;
  }
}
