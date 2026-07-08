// A PDF literal string escape (backslash first, then the string delimiters).
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)) : 0);

// One named jump target: its page object number and page-space (already Y-flipped) top.
interface Dest {
  pageObjNum: number;
  top: number;
}

/**
 * Collects named destinations - the jump targets an internal `Link({ to })` points at, declared with
 * `Anchor({ name })`. `finalize` emits the `/Dests` name-tree fragment for the catalog `/Names` dict, or
 * "" when no anchor was placed. Names are strings the viewer resolves at click time, so a link can point
 * at an anchor on a later (not-yet-rendered) page without any forward-reference bookkeeping.
 */
export class DestRegistry {
  // Keyed by name so a duplicate name resolves to its last definition (last anchor wins).
  private dests = new Map<string, Dest>();

  add(name: string, dest: Dest): void {
    this.dests.set(name, dest);
  }

  get isEmpty(): boolean {
    return this.dests.size === 0;
  }

  /** The `/Dests << /Names [ ... ] >>` fragment for the catalog `/Names` dictionary (merged with any
   *  `/EmbeddedFiles`). Returns "" when empty. Names are sorted lexically - a name tree requires it. */
  finalize(): string {
    if (this.dests.size === 0) return "";
    const entries = [...this.dests.keys()].sort().map((name) => {
      const d = this.dests.get(name)!;
      return `(${esc(name)}) [${d.pageObjNum} 0 R /XYZ null ${num(d.top)} null]`;
    });
    return `/Dests << /Names [ ${entries.join(" ")} ] >>`;
  }
}
