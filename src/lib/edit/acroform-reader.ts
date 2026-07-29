import type { PdfDocument } from "./document.ts";
import { get, isDict, isRef, nameOf, numberOf, textOf, type PdfObject } from "./objects.ts";

/**
 * Reads an existing document's `/AcroForm` into a flat list of fields.
 *
 * The field tree is the part every producer lays out differently, and where a naive reader goes wrong:
 *
 * - **A field and its widget need not be the same object.** pdf-lib splits them (the field carries
 *   `/T`, `/FT` and `/V`; its `/Kids` are bare widget annotations); PDFKit and our own writer merge
 *   them into one. Both are legal, so the walk must cope with either.
 * - **Attributes are inherited.** `/FT`, `/Ff`, `/V` and `/MaxLen` all pass down the tree, so a child may
 *   state none of them and still have a type, flags and a value (ISO 32000-1 table 220).
 * - **Names are hierarchical.** The name you address a field by is the `/T` values along the path,
 *   joined with dots - `address.street`, not `street`.
 * - **A field may own several widgets** (a radio group, or one field shown on several pages). It is
 *   still ONE field with one value.
 */

/** One field found in an existing document, in the terms a caller thinks in. */
export interface ReadField {
  /** The fully qualified name: the `/T` values from the root down, joined with dots. */
  name: string;
  /** `Tx` text · `Btn` button (check box, radio, push button) · `Ch` choice · `Sig` signature. */
  type: "Tx" | "Btn" | "Ch" | "Sig";
  /** The current value as text, if it has one. A button's value is a name (`Yes`, `Off`). */
  value?: string;
  /** A multi-select choice field's values. */
  values?: string[];
  /** The `/Ff` field flags, already merged with anything inherited. */
  flags: number;
  /** `/MaxLen`: the longest text the field accepts, in characters. Inherited like the type. */
  maxLen?: number;
  /** The selectable options of a choice field, as `[export, label]`. */
  options?: Array<{ value: string; label: string }>;
  /** For a check box or radio group: every export name its widgets can take, besides `Off`. */
  onValues?: string[];
  /** The object number of the FIELD dictionary - where `/V` lives, and what an update rewrites. */
  objNum?: number;
  /** The widgets that display this field. A radio group has one per button, and each knows only its
   *  OWN export name, which is what its `/AS` has to be set to. */
  widgets: ReadWidget[];
  /** True when no widget carries an appearance stream - filling it means generating one. */
  needsAppearance: boolean;
}

/** One widget annotation belonging to a field. */
export interface ReadWidget {
  num?: number;
  /** The export names this particular widget can show (its `/AP /N` keys, minus `Off`). */
  onValues: string[];
  hasAppearance: boolean;
}

/** What a document says about its form as a whole. */
export interface ReadForm {
  fields: ReadField[];
  /** The form asks viewers to regenerate every appearance. */
  needAppearances: boolean;
  /**
   * The document carries an XFA packet beside the AcroForm (a "hybrid" form). Filling only the AcroForm
   * side can be ignored by a viewer that prefers XFA, so this is reported rather than glossed over.
   */
  hasXfa: boolean;
  /** True when the cross-reference table had to be rebuilt to read the file at all. */
  recovered: boolean;
}

const FIELD_TYPES = new Set(["Tx", "Btn", "Ch", "Sig"]);

/** Join a parent's qualified name with a child's partial name. */
const joinName = (parent: string, part: string | undefined): string =>
  part === undefined || part === "" ? parent : parent === "" ? part : `${parent}.${part}`;

/** `/Opt` entries are either a bare string or a `[export, label]` pair. */
function readOptions(doc: PdfDocument, raw: PdfObject | undefined) {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((entry) => {
    const e = doc.resolve(entry);
    if (Array.isArray(e)) {
      const value = textOf(doc.resolve(e[0])) ?? "";
      return { value, label: textOf(doc.resolve(e[1])) ?? value };
    }
    const value = textOf(e) ?? "";
    return { value, label: value };
  });
}

/** A value that may be a single string/name or an array of them (a multi-select choice). */
function readValue(doc: PdfDocument, raw: PdfObject | undefined) {
  const v = doc.resolve(raw);
  if (Array.isArray(v)) {
    const values = v.map((x) => textOf(doc.resolve(x)) ?? nameOf(doc.resolve(x)) ?? "");
    return { value: values[0], values };
  }
  const single = textOf(v) ?? nameOf(v);
  return { value: single, values: undefined };
}

/** The export names a button widget can show, read from the keys of its `/AP /N` state dictionary. */
function readOnValues(doc: PdfDocument, widget: PdfObject | undefined): string[] {
  const normal = doc.resolve(get(doc.resolve(get(widget, "AP")), "N"));
  if (normal === undefined || !isDict(normal)) return [];
  return [...normal.map.keys()].filter((k) => k !== "Off");
}

/**
 * Read the form of a loaded document. Returns `undefined` when there is no `/AcroForm` at all - that is
 * a plain PDF, not an error.
 */
export function readAcroForm(doc: PdfDocument): ReadForm | undefined {
  // Until the password has been accepted, every string in an encrypted file is still ciphertext, so a
  // field "name" read out of it is noise. Handing that back would be the silent guess this reader exists
  // to avoid. `PdfDocument.open(bytes, { password })` is what makes it readable.
  if (!doc.isReadable) {
    throw new Error(
      "@jasy/pdf: this PDF is encrypted; open it with PdfDocument.open(bytes, { password }) first",
    );
  }
  const acro = doc.lookup(doc.catalog, "AcroForm");
  if (acro === undefined || !isDict(acro)) return undefined;
  const roots = doc.resolve(get(acro, "Fields"));
  const fields: ReadField[] = [];
  if (Array.isArray(roots)) {
    for (const ref of roots)
      walk(
        doc,
        ref,
        "",
        { type: undefined, flags: 0, maxLen: undefined, value: undefined },
        fields,
        0,
      );
  }
  return {
    fields,
    needAppearances: doc.resolve(get(acro, "NeedAppearances")) === true,
    hasXfa: get(acro, "XFA") !== undefined,
    recovered: doc.recovered,
  };
}

/** The attributes a field takes from its parent when it states none of its own. `/FT`, `/Ff`, `/V` and
 *  `/MaxLen` are all inheritable (ISO 32000-1 table 220), which is how a radio group can hold one value
 *  for kids that state none. */
interface Inherited {
  type: string | undefined;
  flags: number;
  maxLen: number | undefined;
  value: PdfObject | undefined;
}

/**
 * Walk one node of the field tree. A node is a FIELD when it has a type (its own or inherited); its
 * `/Kids` are either more fields or the widgets that display it. The two are told apart by the kids
 * themselves: a widget has no `/T` and no `/FT` of its own.
 */
function walk(
  doc: PdfDocument,
  ref: PdfObject,
  parentName: string,
  parent: Inherited,
  out: ReadField[],
  depth: number,
): void {
  if (depth > 32) return; // a cyclic file must not hang us
  const node = doc.resolve(ref);
  if (node === undefined || !isDict(node)) return;

  const name = joinName(parentName, textOf(doc.lookup(node, "T")));
  const type = nameOf(doc.lookup(node, "FT")) ?? parent.type;
  const flags = numberOf(doc.lookup(node, "Ff")) ?? parent.flags;
  const maxLen = numberOf(doc.lookup(node, "MaxLen")) ?? parent.maxLen;
  const rawValue = get(node, "V") ?? parent.value;
  const kidsRaw = doc.lookup(node, "Kids");
  const kids = Array.isArray(kidsRaw) ? kidsRaw : [];

  // Kids that are themselves fields (they name themselves or state a type) mean this node is only a
  // branch; otherwise the kids are this field's widget annotations.
  const childFields = kids.filter((k) => {
    const kid = doc.resolve(k);
    return get(kid, "T") !== undefined || get(kid, "FT") !== undefined;
  });
  if (childFields.length > 0) {
    for (const k of childFields)
      walk(doc, k, name, { type, flags, maxLen, value: rawValue }, out, depth + 1);
    return;
  }

  if (type === undefined || !FIELD_TYPES.has(type)) return;

  // The widgets: either the kids, or this very object when field and widget are merged.
  const widgetRefs = kids.length > 0 ? kids : [ref];
  const widgets = widgetRefs.map((w) => doc.resolve(w));
  const readWidgets: ReadWidget[] = widgetRefs.map((w, i) => ({
    num: isRef(w) ? w.num : undefined,
    onValues: type === "Btn" ? readOnValues(doc, widgets[i]) : [],
    hasAppearance: get(widgets[i], "AP") !== undefined,
  }));

  let { value, values } = readValue(doc, rawValue);
  const onValues =
    type === "Btn" ? [...new Set(readWidgets.flatMap((w) => w.onValues))] : undefined;

  // A button's value is a NAME by spec (`/Yes`), and that is what its `/AP` state keys are. Producers
  // disagree: PDFKit writes the string `(Yes)`, react-pdf the string `(/Yes)`. All three mean the same
  // export value, so the leading slash is dropped - otherwise comparing a value against the appearance
  // states, which is exactly what filling does, would silently never match.
  if (type === "Btn" && value !== undefined && value.startsWith("/")) value = value.slice(1);

  out.push({
    name,
    type: type as ReadField["type"],
    value,
    values,
    flags,
    maxLen,
    options: readOptions(doc, doc.lookup(node, "Opt")),
    onValues: onValues && onValues.length > 0 ? onValues : undefined,
    objNum: isRef(ref) ? ref.num : undefined,
    widgets: readWidgets,
    // Only meaningful when we know where the widgets are; a field whose widgets all lack /AP has to
    // have one generated before its value can be seen.
    needsAppearance: readWidgets.every((w) => !w.hasAppearance),
  });
}
