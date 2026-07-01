import type { StructTag } from "../ir/display-list.ts";
import type { PDFObjectManager } from "./pdf-object-manager.ts";

// The structure tree for accessible (PDF/UA) tagging: a StructTreeRoot -> Document -> nested StructElem
// graph, plus the ParentTree that maps each page's marked-content ids (MCIDs) back to their StructElem.
//
// The tree is built DURING the render pass: leaves (a paragraph, a figure) and containers (a table, a row,
// a cell) both register via openElement(); containers additionally push()/pop() around their children so
// descendants attach to them (the render pass is sequential depth-first, so a simple stack is exact).

interface StructElem {
  key: number;
  role: string;
  alt?: string;
  parent?: number; // parent element key; undefined = a direct child of the Document
  mc: { structParents: number; mcid: number }[]; // marked-content pieces (for leaves)
}

// Escapes a PDF literal string ( ... ) - the language tag is safe ASCII, but /Alt can carry arbitrary text.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Per-page tagging context: hands out page-local MCIDs and links them to their StructElem. */
export class PageStructContext {
  private mcid = 0;
  constructor(
    readonly structParents: number,
    private readonly tree: StructTree,
  ) {}

  /** Marked-content delimiters for one drawable node. Tagged content gets an MCID linked to its (already
   *  registered) StructElem; untagged content becomes an Artifact (decoration, skipped by assistive tech). */
  mark(tag?: StructTag): { open: string; close: string } {
    // Artifact = decoration, no properties -> BMC (BDC would need a second operand and is a syntax error).
    if (!tag) return { open: "/Artifact BMC\n", close: "EMC\n" };
    const mcid = this.mcid++;
    this.tree.linkMarkedContent(tag.key, this.structParents, mcid);
    return { open: `/${tag.role} <</MCID ${mcid}>> BDC\n`, close: "EMC\n" };
  }
}

/** Builds the PDF structure tree for accessible tagging. One instance per document (held by the object manager). */
export class StructTree {
  enabled = false;
  lang = "en-US";
  title?: string;
  private counter = 0;
  private structParentsCounter = 0;
  private elems = new Map<number, StructElem>(); // insertion order = render order = reading order
  private byStructId = new Map<number, number>(); // element structId -> element key (dedup across pages)
  private stack: number[] = []; // open containers; top is the current parent
  private pageObjByStructParents = new Map<number, number>();

  /** Register a structure element for a logical element (keyed by its stable `structId`, so a paragraph or
   *  table split across pages resolves to the SAME element - MCIDs then accrue from every page). Its parent
   *  is the currently-open container, else the Document. Containers also push()/pop() around their children. */
  openElement(structId: number, role: string, opts?: { alt?: string }): number {
    const existing = this.byStructId.get(structId);
    if (existing !== undefined) return existing; // already opened on an earlier page/fragment
    const key = this.counter++;
    this.byStructId.set(structId, key);
    this.elems.set(key, {
      key,
      role,
      alt: opts?.alt,
      parent: this.stack[this.stack.length - 1],
      mc: [],
    });
    return key;
  }

  push(key: number): void {
    this.stack.push(key);
  }
  pop(): void {
    this.stack.pop();
  }

  /** Begin a page: allocates its StructParents index (its slot in the ParentTree). */
  beginPage(): PageStructContext {
    return new PageStructContext(this.structParentsCounter++, this);
  }

  /** Tie a page's StructParents index to its now-known page object number (for /Pg references). */
  setPageObject(structParents: number, pageObjNum: number): void {
    this.pageObjByStructParents.set(structParents, pageObjNum);
  }

  /** Link a page-local MCID to an element (called by the backend while serializing). */
  linkMarkedContent(key: number, structParents: number, mcid: number): void {
    this.elems.get(key)?.mc.push({ structParents, mcid });
  }

  /** Emit the struct-tree objects and return the catalog additions (`/MarkInfo`, `/StructTreeRoot`, `/Lang`).
   *  A no-op returning "" when disabled or nothing was tagged, so a plain document stays byte-identical. */
  finalize(om: PDFObjectManager): string {
    if (!this.enabled || this.elems.size === 0) return "";

    // Reserve object numbers first - root <-> Document <-> elements <-> ParentTree reference each other.
    const rootNum = om.addObject("");
    const docNum = om.addObject("");
    const parentTreeNum = om.addObject("");
    const objNum = new Map<number, number>();
    for (const key of this.elems.keys()) objNum.set(key, om.addObject(""));

    const pg = (structParents: number) => this.pageObjByStructParents.get(structParents)!;
    const childrenOf = (parent: number | undefined) =>
      [...this.elems.values()].filter((e) => e.parent === parent); // Map order = reading order

    // One StructElem per registered element: /K = its child elements ++ its marked-content references.
    for (const e of this.elems.values()) {
      const kids = [
        ...childrenOf(e.key).map((c) => `${objNum.get(c.key)!} 0 R`),
        ...e.mc.map((m) => `<< /Type /MCR /Pg ${pg(m.structParents)} 0 R /MCID ${m.mcid} >>`),
      ].join(" ");
      const alt = e.alt ? ` /Alt (${esc(e.alt)})` : "";
      // PDF/UA 7.5: a header cell needs a Scope so a reader can associate data cells with it. Our headers
      // are a header ROW (the Table `header` option), so each TH is the head of its Column.
      const attr = e.role === "TH" ? " /A << /O /Table /Scope /Column >>" : "";
      const parentRef = e.parent !== undefined ? objNum.get(e.parent)! : docNum;
      om.replaceObject(
        objNum.get(e.key)!,
        `<< /Type /StructElem /S /${e.role} /P ${parentRef} 0 R${alt}${attr} /K [ ${kids} ] >>`,
      );
    }

    // The Document element wraps the top-level elements in reading order.
    const docKids = childrenOf(undefined)
      .map((e) => `${objNum.get(e.key)!} 0 R`)
      .join(" ");
    om.replaceObject(
      docNum,
      `<< /Type /StructElem /S /Document /P ${rootNum} 0 R /K [ ${docKids} ] >>`,
    );

    // ParentTree: for each page (StructParents index), an array where [mcid] = the owning StructElem.
    const byPage = new Map<number, { mcid: number; key: number }[]>();
    for (const e of this.elems.values()) {
      for (const m of e.mc) {
        const list = byPage.get(m.structParents) ?? [];
        list.push({ mcid: m.mcid, key: e.key });
        byPage.set(m.structParents, list);
      }
    }
    const nums = [...byPage.keys()]
      .sort((a, b) => a - b)
      .map((sp) => {
        const refs = byPage
          .get(sp)!
          .slice()
          .sort((a, b) => a.mcid - b.mcid)
          .map((r) => `${objNum.get(r.key)!} 0 R`)
          .join(" ");
        return `${sp} [ ${refs} ]`;
      });
    om.replaceObject(parentTreeNum, `<< /Nums [ ${nums.join(" ")} ] >>`);

    om.replaceObject(
      rootNum,
      `<< /Type /StructTreeRoot /K ${docNum} 0 R /ParentTree ${parentTreeNum} 0 R ` +
        `/ParentTreeNextKey ${this.structParentsCounter} >>`,
    );

    return `/MarkInfo << /Marked true >> /StructTreeRoot ${rootNum} 0 R /Lang (${esc(this.lang)})`;
  }
}
