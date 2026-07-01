import type { StructTag } from "../ir/display-list.ts";
import type { PDFObjectManager } from "./pdf-object-manager.ts";

// The structure tree for accessible (PDF/UA) tagging: a StructTreeRoot -> Document -> per-element StructElem
// graph, plus the ParentTree that maps each page's marked-content ids (MCIDs) back to their StructElem. The
// engine owns all of this; components only declare a `role` on the IR (see StructTag). New elements become
// taggable just by tagging their IR - nothing here needs to change.

interface McRecord {
  key: number; // logical-element key (groups the IR nodes of one element)
  role: string;
  alt?: string;
  structParents: number; // the page's StructParents index
  mcid: number; // page-local marked-content id
}

// Escapes a PDF literal string ( ... ) - the language tag is safe ASCII, but /Alt can carry arbitrary text.
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Per-page tagging context: hands out page-local MCIDs and records which StructElem owns each. */
export class PageStructContext {
  private mcid = 0;
  constructor(
    readonly structParents: number,
    private readonly tree: StructTree,
  ) {}

  /** Marked-content delimiters for one drawable node. Tagged content gets an MCID + a record; untagged
   *  content becomes an Artifact (decoration, skipped by assistive technology). */
  mark(tag?: StructTag): { open: string; close: string } {
    if (!tag) return { open: "/Artifact BDC\n", close: "EMC\n" };
    const mcid = this.mcid++;
    this.tree.record({
      key: tag.key,
      role: tag.role,
      alt: tag.alt,
      structParents: this.structParents,
      mcid,
    });
    return { open: `/${tag.role} <</MCID ${mcid}>> BDC\n`, close: "EMC\n" };
  }
}

/** Builds the PDF structure tree for accessible tagging. One instance per document (held by the object manager). */
export class StructTree {
  enabled = false;
  lang = "en-US";
  title?: string;
  private keyCounter = 0;
  private structParentsCounter = 0;
  private records: McRecord[] = [];
  private pageObjByStructParents = new Map<number, number>();

  /** A fresh logical-element key - groups the IR nodes of one element (e.g. a paragraph's lines) into one StructElem. */
  nextKey(): number {
    return this.keyCounter++;
  }

  /** Begin a page: allocate its StructParents index. Returns the per-page tagging context. */
  beginPage(): PageStructContext {
    return new PageStructContext(this.structParentsCounter++, this);
  }

  /** Tie a page's StructParents index to its now-known page object number (for /Pg references). */
  setPageObject(structParents: number, pageObjNum: number): void {
    this.pageObjByStructParents.set(structParents, pageObjNum);
  }

  record(r: McRecord): void {
    this.records.push(r);
  }

  /** Emit the struct-tree objects and return the catalog additions (`/MarkInfo`, `/StructTreeRoot`, `/Lang`).
   *  A no-op returning "" when disabled or nothing was tagged, so a plain document stays byte-identical. */
  finalize(om: PDFObjectManager): string {
    if (!this.enabled || this.records.length === 0) return "";

    // Group records into elements by key, preserving first-seen (reading) order.
    const order: number[] = [];
    const byKey = new Map<number, { role: string; alt?: string; refs: McRecord[] }>();
    for (const r of this.records) {
      let e = byKey.get(r.key);
      if (!e) {
        e = { role: r.role, alt: r.alt, refs: [] };
        byKey.set(r.key, e);
        order.push(r.key);
      }
      e.refs.push(r);
    }

    // Reserve object numbers first - root <-> Document <-> elements <-> ParentTree reference each other.
    const rootNum = om.addObject("");
    const docNum = om.addObject("");
    const parentTreeNum = om.addObject("");
    const elemNum = new Map<number, number>();
    for (const key of order) elemNum.set(key, om.addObject(""));

    const pg = (structParents: number) => this.pageObjByStructParents.get(structParents)!;

    // One StructElem per logical element, its kids the marked-content references (MCR) on their pages.
    for (const key of order) {
      const e = byKey.get(key)!;
      const kids = e.refs
        .map((r) => `<< /Type /MCR /Pg ${pg(r.structParents)} 0 R /MCID ${r.mcid} >>`)
        .join(" ");
      const alt = e.alt ? ` /Alt (${esc(e.alt)})` : "";
      om.replaceObject(
        elemNum.get(key)!,
        `<< /Type /StructElem /S /${e.role} /P ${docNum} 0 R${alt} /K [ ${kids} ] >>`,
      );
    }

    // The Document element wraps every element in reading order.
    const docKids = order.map((k) => `${elemNum.get(k)!} 0 R`).join(" ");
    om.replaceObject(
      docNum,
      `<< /Type /StructElem /S /Document /P ${rootNum} 0 R /K [ ${docKids} ] >>`,
    );

    // ParentTree: for each page (StructParents index), an array where [mcid] = the owning StructElem.
    const bySp = new Map<number, McRecord[]>();
    for (const r of this.records) {
      const list = bySp.get(r.structParents) ?? [];
      list.push(r);
      bySp.set(r.structParents, list);
    }
    const nums = [...bySp.keys()]
      .sort((a, b) => a - b)
      .map((sp) => {
        const refs = bySp
          .get(sp)!
          .slice()
          .sort((a, b) => a.mcid - b.mcid)
          .map((r) => `${elemNum.get(r.key)!} 0 R`)
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
