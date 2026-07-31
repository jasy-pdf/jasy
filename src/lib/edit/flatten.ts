import { PdfDocument } from "./document.ts";
import { readAcroForm, type ReadField } from "./acroform-reader.ts";
import { bakeAppearance, bakeButtonStates, readLook } from "./appearance.ts";
import { getArrayBuffer } from "../utils/utf8-to-windows1252-encoder.ts";
import { latin1FromBytes } from "../utils/bytes.ts";
import { carryStrings, IncrementalWriter, serialize, type StringCipher } from "./writer.ts";
import {
  get,
  isDict,
  isRef,
  isStream,
  nameOf,
  type PdfDict,
  type PdfObject,
  type PdfRef,
} from "./objects.ts";

/**
 * Flattening a form: the values stop being editable fields and become part of the page.
 *
 * The trick is that there is nothing to DRAW. A field's appearance already is a Form XObject - the
 * little picture the viewer shows - so flattening means stamping that XObject onto the page and taking
 * the widget away. Nothing is re-rendered, so a flattened field looks exactly as it did before, down to
 * the pixel. (pdf-lib does the same; react-pdf and PDFKit cannot flatten at all, they never read a file.)
 *
 * It stays an INCREMENTAL update: the new drawing goes into a NEW content stream appended to the page's
 * `/Contents` array, never into the existing one. So the original bytes are still a literal prefix of the
 * result.
 *
 * **A widget that ships no appearance gets one drawn** from its own style and current value, the same
 * drawing the fill path bakes - PDFKit and react-pdf write none at all and leave every box to the
 * viewer. Only a widget we cannot draw AT ALL, one without a usable `/Rect` or of a kind that has no
 * picture of its own, is refused, and then by name.
 */

export interface FlattenOptions {
  /** The user password, for a document that is encrypted. */
  password?: string;
  /** Flatten only these fields (fully qualified names). Omit for all of them. */
  fields?: string[];
}

export interface FlattenResult {
  bytes: Uint8Array;
  /** The names that were turned into page content. */
  flattened: string[];
  warnings: string[];
}

export class FlattenError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

// Field flags we have to read here (see `forms/acroform.ts` for the writer's side).
const FF_PUSHBUTTON = 1 << 16;
const FF_RADIO = 1 << 15;

/** A widget ready to be stamped: which page it sits on, its appearance, and where it goes. */
interface Stamp {
  pageNum: number;
  appearance: PdfRef;
  rect: [number, number, number, number];
  bbox: [number, number, number, number];
  matrix?: number[];
  widget: PdfRef;
}

const numbers = (o: PdfObject | undefined, n: number): number[] | undefined => {
  if (!Array.isArray(o) || o.length < n) return undefined;
  const out = o.slice(0, n).map((x) => (typeof x === "number" ? x : NaN));
  return out.some(Number.isNaN) ? undefined : out;
};

/**
 * Where a form XObject has to be placed so its box lands on the annotation's rectangle (PDF 12.5.5).
 *
 * Not just a translation: the appearance declares its own `/BBox` and an optional `/Matrix`, and the
 * result has to be mapped onto `/Rect`. For everything we and pdf-lib produce the BBox starts at the
 * origin and matches the rect, so this collapses to a plain shift - but a foreign file may differ, and
 * then a plain shift puts the drawing in the wrong place at the wrong size.
 */
function placement(stamp: Stamp): number[] {
  const [bx0, by0, bx1, by1] = stamp.bbox;
  const m = stamp.matrix ?? [1, 0, 0, 1, 0, 0];
  // The four corners of the BBox through /Matrix, then their bounding box.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const tx0 = Math.min(...xs);
  const ty0 = Math.min(...ys);
  const tw = Math.max(...xs) - tx0;
  const th = Math.max(...ys) - ty0;

  const [rx0, ry0, rx1, ry1] = stamp.rect;
  const rw = Math.abs(rx1 - rx0);
  const rh = Math.abs(ry1 - ry0);
  const sx = tw === 0 ? 1 : rw / tw;
  const sy = th === 0 ? 1 : rh / th;
  return [sx, 0, 0, sy, Math.min(rx0, rx1) - tx0 * sx, Math.min(ry0, ry1) - ty0 * sy];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6))));

/** Map every widget object number to the page that lists it in `/Annots`. */
function widgetPages(doc: PdfDocument): Map<number, number> {
  const out = new Map<number, number>();
  const visit = (node: PdfObject | undefined, depth: number): void => {
    if (depth > 64) return;
    const dict = doc.resolve(node);
    if (dict === undefined || !isDict(dict)) return;
    const kids = doc.lookup(dict, "Kids");
    if (Array.isArray(kids)) {
      for (const k of kids) visit(k, depth + 1);
      return;
    }
    const pageNum = isRef(node) ? node.num : undefined;
    if (pageNum === undefined) return;
    const annots = doc.lookup(dict, "Annots");
    if (!Array.isArray(annots)) return;
    for (const a of annots) if (isRef(a)) out.set(a.num, pageNum);
  };
  visit(doc.trailer.map.get("Root") && get(doc.catalog, "Pages"), 0);
  return out;
}

/**
 * The appearance to stamp for one widget. A button's `/AP /N` is a dictionary of STATES (`/Yes`, `/Off`)
 * and the one to keep is whichever `/AS` currently shows - flattening a check box has to freeze what the
 * reader sees, not some other state.
 */
function appearanceOf(doc: PdfDocument, widget: PdfObject | undefined): PdfRef | undefined {
  const n = get(doc.resolve(get(widget, "AP")), "N");
  if (isRef(n)) {
    const target = doc.resolve(n);
    return isStream(target) ? n : undefined;
  }
  const states = doc.resolve(n);
  if (states === undefined || !isDict(states)) return undefined;
  const as = nameOf(doc.lookup(widget, "AS"));
  const chosen = as !== undefined ? states.map.get(as) : undefined;
  return isRef(chosen) ? chosen : undefined;
}

/**
 * Collect what has to happen. A widget that ships NO appearance gets one drawn now, from its own style
 * and current value - the same drawing the fill path bakes. Without that, flattening a form from a
 * producer that writes no appearances (PDFKit, react-pdf) could only ever refuse.
 *
 * `fresh` overrides where a widget's picture comes from. It is empty for a plain `flattenForm`, and
 * carries the just-baked appearances when a fill flattens in the same pass - see `FreshAppearances`.
 */
async function planStamps(
  doc: PdfDocument,
  writer: IncrementalWriter,
  fields: ReadField[],
  fresh?: FreshAppearances,
): Promise<{ stamps: Stamp[]; removeOnly: Map<number, number> }> {
  const pages = widgetPages(doc);
  const stamps: Stamp[] = [];
  // Widgets that leave the page without leaving a picture: a push button with no face of its own. It
  // draws nothing and holds no value, and after flattening it could not do anything anyway, so keeping
  // it would leave a dead control on a document that is no longer a form.
  const removeOnly = new Map<number, number>();
  const missing: string[] = [];
  const offPage: string[] = [];

  for (const field of fields) {
    for (const w of field.widgets) {
      if (w.num === undefined) continue;
      const widget = doc.getObject(w.num);
      // A picture written during THIS pass wins: it lives in the writer, not in `doc`, so reading the
      // document would freeze the value the field had BEFORE the fill.
      let appearance = fresh?.get(w.num) ?? appearanceOf(doc, widget);
      if (appearance === undefined) {
        const drawnNum = await drawMissing(doc, writer, field, w.num);
        if (drawnNum === undefined) {
          const page = pages.get(w.num);
          if ((field.flags & FF_PUSHBUTTON) !== 0 && page !== undefined) {
            removeOnly.set(w.num, page);
          } else if (!missing.includes(field.name)) {
            missing.push(field.name);
          }
          continue;
        }
        appearance = { kind: "ref", num: drawnNum, gen: 0 };
      }
      const pageNum = pages.get(w.num);
      if (pageNum === undefined) {
        if (!offPage.includes(field.name)) offPage.push(field.name);
        continue;
      }
      const rect = numbers(doc.lookup(widget, "Rect"), 4);
      const stream = doc.resolve(appearance);
      const bbox = numbers(doc.lookup(stream, "BBox"), 4) ?? [
        0,
        0,
        rect ? Math.abs(rect[2] - rect[0]) : 0,
        rect ? Math.abs(rect[3] - rect[1]) : 0,
      ];
      if (rect === undefined || bbox === undefined) {
        if (!missing.includes(field.name)) missing.push(field.name);
        continue;
      }
      stamps.push({
        pageNum,
        appearance,
        rect: rect as Stamp["rect"],
        bbox: bbox as Stamp["bbox"],
        matrix: numbers(doc.lookup(stream, "Matrix"), 6),
        widget: { kind: "ref", num: w.num, gen: 0 },
      });
    }
  }

  if (missing.length > 0) {
    throw new FlattenError(
      `these fields could not be drawn, so flattening them would leave an empty box: ` +
        `${missing.map((n) => `"${n}"`).join(", ")}. A widget needs a /Rect and a kind we can draw`,
    );
  }
  if (offPage.length > 0) {
    throw new FlattenError(
      `these fields have a widget that no page lists in /Annots, so there is nowhere to stamp it: ` +
        offPage.map((n) => `"${n}"`).join(", "),
    );
  }
  return { stamps, removeOnly };
}

/** The page's existing content, decoded, or undefined when it cannot be read. */
function existingContent(doc: PdfDocument, contents: PdfObject | undefined): string | undefined {
  const resolved = doc.resolve(contents);
  const parts = Array.isArray(resolved) ? resolved : [contents];
  let out = "";
  for (const p of parts) {
    const stream = doc.resolve(p);
    if (stream === undefined || !isStream(stream)) return undefined;
    out += latin1FromBytes(doc.streamData(stream)) + "\n";
  }
  return out;
}

/** Draw a widget that has no appearance, and return the object number of the new XObject. */
async function drawMissing(
  doc: PdfDocument,
  writer: IncrementalWriter,
  field: ReadField,
  widgetNum: number,
): Promise<number | undefined> {
  const widget = doc.getObject(widgetNum);
  const look = readLook(doc, widget, field);
  if (look === undefined || look.width <= 0 || look.height <= 0) return undefined;

  let content: string;
  let bbox: [number, number, number, number];
  if (field.type === "Btn") {
    // A PUSH button has no on/off states and no value - it is a control, not a picture of anything. It
    // carries whatever face its author drew, and if there is none there is nothing to freeze.
    if ((field.flags & FF_PUSHBUTTON) !== 0) return undefined;
    // Freeze the state the widget is CURRENTLY showing - flattening captures what the reader sees.
    const as = nameOf(doc.lookup(widget, "AS")) ?? field.value ?? "Off";
    const radio = (field.flags & FF_RADIO) !== 0;
    const faces = bakeButtonStates(look, as === "Off" ? (field.onValues?.[0] ?? "Yes") : as, radio);
    content = as === "Off" ? faces.off : faces.on;
    bbox = faces.bbox;
  } else {
    const face = bakeAppearance(look, field, field.value, field.values);
    if (face === undefined) return undefined;
    content = face.content;
    bbox = face.bbox;
  }
  const encoded = new Uint8Array(getArrayBuffer(content));
  return writer.add({
    dict:
      `/Type /XObject /Subtype /Form /BBox [${bbox.map((n) => Number(n.toFixed(2))).join(" ")}] ` +
      `/Resources << /Font << /Helv ${writer.helv()} 0 R >> >>`,
    data: (await doc.encryptForWrite(encoded)) ?? encoded,
  });
}

/**
 * Does the page's own content leave the graphics state changed?
 *
 * When `/Contents` holds several streams the spec treats them as ONE - so whatever the existing content
 * leaves in effect applies to anything appended. That is not a bug in the producer: nothing follows a
 * page, so nothing has to be restored. But PDFKit and react-pdf both open with `1 0 0 -1 0 <h> cm`,
 * flipping the page to a top-left origin and never undoing it, and our stamps would land upside down.
 *
 * Answered CONSERVATIVELY: only a stream we can prove to be state-neutral - balanced `q`/`Q` and no
 * state operator outside them - is left alone. Anything else, including anything we cannot scan
 * reliably, gets wrapped.
 */
function leavesStateDirty(content: string): boolean {
  // Strings can contain anything, including something that looks like an operator.
  const code = content.replace(/\((?:\\.|[^\\)])*\)/g, " ").replace(/<[0-9A-Fa-f\s]*>/g, " ");
  if (/\bBI\b/.test(code)) return true; // an inline image swallows arbitrary bytes - do not guess
  let depth = 0;
  for (const token of code.split(/\s+/)) {
    if (token === "q") depth++;
    else if (token === "Q") {
      if (--depth < 0) return true;
    } else if (depth === 0 && ["cm", "gs", "W", "W*", "cs", "CS", "sh"].includes(token)) {
      return true;
    }
  }
  return depth !== 0;
}

/** A resource name for the stamped XObject that does not collide with one the page already uses. */
function freeName(taken: Set<string>, i: number): string {
  let name = `JasyFlat${i}`;
  let n = i;
  while (taken.has(name)) name = `JasyFlat${i}_${++n}`;
  taken.add(name);
  return name;
}

/** Rewrite a dictionary with entries replaced or dropped, like `fill.ts` does. */
function withEntries(
  dict: PdfDict,
  changes: Record<string, string | undefined>,
  cipher?: StringCipher,
): string {
  const parts: string[] = [];
  for (const [k, v] of dict.map) {
    if (Object.prototype.hasOwnProperty.call(changes, k)) continue;
    parts.push(`/${k} ${serialize(v, cipher)}`);
  }
  for (const [k, v] of Object.entries(changes)) if (v !== undefined) parts.push(`/${k} ${v}`);
  return `<< ${parts.join(" ")} >>`;
}

/**
 * The appearance streams a fill has just written, keyed by widget object number.
 *
 * Flattening freezes the picture a widget currently shows, and it reads that picture out of the
 * document. In the same pass as a fill the new picture is not in the document yet - it is in the
 * writer, appended but not saved - so without this map a filled-and-flattened form would stamp the
 * value the field had BEFORE the fill. It applies to both kinds of widget, which go stale for two
 * different reasons: a text field's `/AP` is replaced outright, and a button's `/AP` keeps all its
 * states while `/AS` moves to pick a different one.
 */
export type FreshAppearances = ReadonlyMap<number, PdfRef>;

/**
 * Stamp the fields into their pages and take the widgets away. Shared by `flattenForm` and
 * `fillForm(..., { flatten: true })`, so filling and flattening produce ONE incremental update.
 */
export async function flattenInto(
  doc: PdfDocument,
  writer: IncrementalWriter,
  fields: ReadField[],
  carriedIn?: StringCipher,
  fresh?: FreshAppearances,
): Promise<string[]> {
  if (fields.length === 0) return [];
  const { stamps, removeOnly } = await planStamps(doc, writer, fields, fresh);

  // Group by page: one appended content stream per page, not one per widget.
  const byPage = new Map<number, Stamp[]>();
  for (const s of stamps)
    (byPage.get(s.pageNum) ?? byPage.set(s.pageNum, []).get(s.pageNum)!).push(s);

  // In an encrypted document every string in a rewritten object has to be enciphered again, or
  // `serialize` writes it back in the clear - ISSUE-7, one object at a time. The caller's map (a fill
  // flattening in the same pass) is the seed; the pages are what only this pass touches.
  //
  // NOT reachable today, and therefore not covered by a test: we can only write R6, so the only
  // encrypted files we can flatten are our own, and ours reference every annotation as its own object -
  // a page dictionary of ours holds no string at all. It matters the moment a producer inlines an
  // annotation (its /Contents and /URI are strings), which is why it is wired rather than left as a
  // trap. Same reasoning as the `alsoRewritten` pass in `fill.ts`.
  const acroDict = doc.resolve(get(doc.catalog, "AcroForm"));
  const cipher = await carryStrings(
    doc,
    [...[...byPage.keys()].map((n) => doc.getObject(n)), acroDict, doc.catalog],
    new Map(carriedIn ?? []),
  );

  for (const [pageNum, pageStamps] of byPage) {
    const page = doc.getObject(pageNum);
    if (page === undefined || !isDict(page)) continue;

    // The XObject resources the page already has, so a new name cannot shadow one.
    const resources = doc.resolve(get(page, "Resources"));
    const xobjects = isDict(resources) ? doc.resolve(get(resources, "XObject")) : undefined;
    const taken = new Set(isDict(xobjects) ? [...xobjects.map.keys()] : []);

    let ops = "";
    const added: string[] = [];
    pageStamps.forEach((s, i) => {
      const name = freeName(taken, i + 1);
      added.push(`/${name} ${s.appearance.num} ${s.appearance.gen} R`);
      const m = placement(s).map(fmt).join(" ");
      ops += `q ${m} cm /${name} Do Q\n`;
    });

    // /Contents becomes an ARRAY with our stream appended - the existing one is never touched.
    const contents = get(page, "Contents");
    const existing = Array.isArray(doc.resolve(contents))
      ? (doc.resolve(contents) as PdfObject[]).map((c) => serialize(c, cipher))
      : contents !== undefined
        ? [serialize(contents, cipher)]
        : [];

    // If the page leaves the graphics state changed, bracket its content in q/Q so our stamps start
    // from the default state. Only then - a well-behaved page pays nothing.
    const own = existingContent(doc, contents);
    const wrap = own !== undefined && leavesStateDirty(own);
    const front: string[] = [];
    if (wrap) {
      const q = new Uint8Array(getArrayBuffer("q\n"));
      front.push(`${writer.add({ dict: "", data: (await doc.encryptForWrite(q)) ?? q })} 0 R`);
    }

    let newContents: string | undefined;
    if (ops !== "") {
      const body = (wrap ? "Q\n" : "") + ops;
      const data = new Uint8Array(getArrayBuffer(body));
      const streamNum = writer.add({ dict: "", data: (await doc.encryptForWrite(data)) ?? data });
      newContents = `[${[...front, ...existing, `${streamNum} 0 R`].join(" ")}]`;
    }

    // The widgets we stamped leave /Annots; anything else on the page stays.
    const flattenedRefs = new Set(pageStamps.map((s) => s.widget.num));
    for (const [widget, page] of removeOnly) if (page === pageNum) flattenedRefs.add(widget);
    const annots = doc.resolve(get(page, "Annots"));
    const keptAnnots = Array.isArray(annots)
      ? annots.filter((a) => !(isRef(a) && flattenedRefs.has(a.num)))
      : [];
    const newXObjects = isDict(xobjects)
      ? `<< ${[...xobjects.map].map(([k, v]) => `/${k} ${serialize(v, cipher)}`).join(" ")} ${added.join(" ")} >>`
      : `<< ${added.join(" ")} >>`;
    const newResources = isDict(resources)
      ? withEntries(resources, { XObject: newXObjects }, cipher)
      : `<< /XObject ${newXObjects} >>`;

    writer.update(
      pageNum,
      withEntries(
        page,
        {
          ...(newContents !== undefined ? { Contents: newContents } : {}),
          Annots: `[${keptAnnots.map((a) => serialize(a, cipher)).join(" ")}]`,
          Resources: newResources,
        },
        cipher,
      ),
    );
  }

  // The fields are gone from the form. Their objects stay in the file, simply unreferenced - an
  // incremental update appends, it cannot delete.
  const acroRef = get(doc.catalog, "AcroForm");
  const acro = doc.resolve(acroRef);
  if (acro !== undefined && isDict(acro)) {
    const gone = new Set(fields.map((f) => f.objNum).filter((n): n is number => n !== undefined));
    // A flattened field may hang in a PARENT's /Kids rather than in the form's /Fields. Dropping it only
    // from the root leaves it reachable, so `readAcroForm` still reports a field with no widget left.
    //
    // Planned first, written after: a surviving parent is rewritten WHOLE, so it carries its own /T,
    // /TU and /DA along - and those are strings that have to be enciphered like any other. Collecting
    // them needs an await, which is why the walk itself stays synchronous and only plans.
    const prunes = pruneKids(doc, get(acro, "Fields"), gone);
    await carryStrings(
      doc,
      prunes.map((p) => p.node),
      cipher,
    );
    for (const p of prunes) {
      writer.update(
        p.num,
        withEntries(
          p.node,
          { Kids: `[${p.kept.map((k) => serialize(k, cipher)).join(" ")}]` },
          cipher,
        ),
      );
    }
    const roots = doc.resolve(get(acro, "Fields"));
    const kept = Array.isArray(roots) ? roots.filter((r) => !(isRef(r) && gone.has(r.num))) : [];
    const newAcro = withEntries(
      acro,
      {
        Fields: `[${kept.map((r) => serialize(r, cipher)).join(" ")}]`,
        // A form with nothing left in it asking a viewer to regenerate appearances is a document
        // contradicting itself, so the flag goes with the last field.
        ...(kept.length === 0 ? { NeedAppearances: undefined } : {}),
      },
      cipher,
    );
    if (isRef(acroRef)) {
      writer.update(acroRef.num, newAcro);
    } else {
      // The form dict can sit INLINE in the catalog - our own writer puts it there - and then the
      // CATALOG is what has to be rewritten. Skipping it left every field listed in a form that no
      // longer has any widgets: a document contradicting itself.
      const rootRef = doc.trailer.map.get("Root");
      const catalog = doc.catalog;
      if (isRef(rootRef) && catalog !== undefined && isDict(catalog)) {
        writer.update(rootRef.num, withEntries(catalog, { AcroForm: newAcro }, cipher));
      }
    }
  }

  return fields.map((f) => f.name);
}

/**
 * Walk the field tree and rewrite every `/Kids` that still points at a flattened field. A branch left
 * with no children at all is added to `gone` so its own owner drops it too.
 */
function pruneKids(
  doc: PdfDocument,
  list: PdfObject | undefined,
  gone: Set<number>,
  out: Array<{ num: number; node: PdfDict; kept: PdfObject[] }> = [],
  depth = 0,
): Array<{ num: number; node: PdfDict; kept: PdfObject[] }> {
  if (depth > 32) return out;
  const entries = doc.resolve(list);
  if (!Array.isArray(entries)) return out;
  for (const ref of entries) {
    if (!isRef(ref) || gone.has(ref.num)) continue;
    const node = doc.resolve(ref);
    if (node === undefined || !isDict(node)) continue;
    const kids = get(node, "Kids");
    if (kids === undefined) continue;
    pruneKids(doc, kids, gone, out, depth + 1);
    const resolved = doc.resolve(kids);
    if (!Array.isArray(resolved)) continue;
    const kept = resolved.filter((k) => !(isRef(k) && gone.has(k.num)));
    if (kept.length === resolved.length) continue;
    if (kept.length === 0) {
      gone.add(ref.num); // an empty branch is a field with nothing left to show
      continue;
    }
    out.push({ num: ref.num, node, kept });
  }
  return out;
}

/** Flatten an existing form: its values become page content and stop being editable. */
export async function flattenForm(
  bytes: Uint8Array,
  options: FlattenOptions = {},
): Promise<FlattenResult> {
  const doc = await PdfDocument.open(bytes, { password: options.password });
  if (!doc.canReEncrypt) {
    throw new FlattenError(
      "this PDF is encrypted with RC4 or AES-128; jasy can open it but writes only AES-256, so " +
        "flattening it would have to downgrade its protection - refused",
    );
  }

  const form = readAcroForm(doc);
  if (!form) throw new FlattenError("this PDF has no AcroForm to flatten");

  const warnings: string[] = [];
  if (form.hasXfa) {
    warnings.push(
      "This document is an AcroForm/XFA hybrid; a viewer that prefers the XFA packet may still show " +
        "editable fields.",
    );
  }

  const byName = new Map(form.fields.map((f) => [f.name, f]));
  const wanted = options.fields;
  if (wanted) {
    const unknown = wanted.filter((n) => !byName.has(n));
    if (unknown.length > 0) {
      throw new FlattenError(
        `no such field: ${unknown.map((n) => `"${n}"`).join(", ")}. This form has: ` +
          form.fields.map((f) => `"${f.name}"`).join(", "),
      );
    }
  }
  const fields = wanted ? wanted.map((n) => byName.get(n)!) : form.fields;

  const writer = new IncrementalWriter(doc);
  const flattened = await flattenInto(doc, writer, fields);
  return { bytes: writer.save(), flattened, warnings };
}
