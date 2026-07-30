import { PdfDocument } from "./document.ts";
import { readAcroForm, type ReadField } from "./acroform-reader.ts";
import { IncrementalWriter, serialize, type StringCipher } from "./writer.ts";
import {
  get,
  isDict,
  isRef,
  isString,
  type PdfDict,
  type PdfObject,
  type PdfString,
} from "./objects.ts";

/**
 * Filling the form of an EXISTING PDF.
 *
 * The values are plain data - `{ name: "Ada", agree: true }` - not a sequence of calls on field objects.
 * That is the same shape the rest of jasy takes: you say WHAT the document should hold, not how to poke
 * it in.
 *
 * A form is treated as a CONTRACT. A name that is not in it, a value its type cannot hold, a string past
 * `/MaxLen`, a choice outside `/Opt`, a read-only field - each is a named error, never a silent no-op.
 * Getting back a file where half the values quietly did not apply is the worst possible outcome.
 */

/** What a field can be set to. `null` clears it; a boolean is for check boxes; an array is a
 *  multi-select choice. */
export type FieldValue = string | boolean | string[] | null;

export interface FillOptions {
  /** The user password, for a document that is encrypted. Wrong or missing gives a named error. */
  password?: string;
  /**
   * Leave the drawing of the values to the viewer by setting `/NeedAppearances`, instead of generating
   * appearance streams. Default `true` today - baking them is the next step.
   */
  needAppearances?: boolean;
}

export interface FillResult {
  bytes: Uint8Array;
  /** Things worth knowing that are not errors - an XFA hybrid, a rebuilt index. */
  warnings: string[];
  /** The names actually written. */
  filled: string[];
}

/** Field flags we have to honour when filling (see `forms/acroform.ts` for the writer's side). */
const FF_READ_ONLY = 1 << 0;
const FF_MULTI_SELECT = 1 << 21;
const FF_EDIT = 1 << 18;
const FF_PUSHBUTTON = 1 << 16;
const FF_RADIO = 1 << 15;

/**
 * A text value in PDF form. Plain ASCII becomes a `(literal)`; anything else becomes a UTF-16BE `<hex>`
 * string behind a byte-order mark - the encoding every producer uses for unicode, and the only one that
 * carries an umlaut or an emoji unambiguously. Writing UTF-8 into a literal (the obvious mistake) reads
 * back as mojibake, because a literal is PDFDocEncoded.
 */
const plainBytes = (s: string): Uint8Array => {
  if (/^[\x20-\x7e]*$/.test(s)) return Uint8Array.from(s, (c) => c.charCodeAt(0));
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) >> 8;
    out[3 + i * 2] = s.charCodeAt(i) & 0xff;
  }
  return out;
};

const hex = (b: Uint8Array): string =>
  `<${Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join("")}>`;

/** A value in PDF form. `enciphered` holds ciphertext for the strings of an encrypted document; without
 *  it the value is written in the clear, exactly as before. */
const pdfText = (s: string, enciphered?: Map<string, string>): string => {
  const ready = enciphered?.get(s);
  if (ready !== undefined) return ready;
  const ascii = /^[\x20-\x7e]*$/.test(s);
  if (ascii) {
    return `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
  }
  let out = "FEFF";
  for (let i = 0; i < s.length; i++)
    out += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${out}>`;
};

const escName = (s: string): string =>
  Array.from(new TextEncoder().encode(s))
    .map((b) =>
      b >= 0x21 && b <= 0x7e && !"()<>[]{}/%#".includes(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : "#" + b.toString(16).padStart(2, "0").toUpperCase(),
    )
    .join("");

/** Rewrite a dictionary with some entries replaced or removed, keeping everything else byte-faithful. */
function withEntries(
  dict: PdfDict,
  changes: Record<string, string | undefined>,
  cipher?: StringCipher,
): string {
  const parts: string[] = [];
  for (const [k, v] of dict.map) {
    // hasOwnProperty, not `in`: a PDF key may legitimately be called "constructor" or "toString", and
    // `in` would find those on Object.prototype and silently drop the entry.
    if (Object.prototype.hasOwnProperty.call(changes, k)) continue; // replaced or dropped below
    parts.push(`/${escName(k)} ${serialize(v, cipher)}`);
  }
  for (const [k, v] of Object.entries(changes))
    if (v !== undefined) parts.push(`/${escName(k)} ${v}`);
  return `<< ${parts.join(" ")} >>`;
}

/** Every string reachable inside an object, so a dictionary can be re-enciphered in one walk. */
function stringsIn(o: PdfObject | undefined, out: PdfString[] = [], depth = 0): PdfString[] {
  if (o === undefined || o === null || depth > 64) return out;
  if (isString(o)) out.push(o);
  else if (Array.isArray(o)) for (const e of o) stringsIn(e, out, depth + 1);
  else if (isDict(o)) for (const v of o.map.values()) stringsIn(v, out, depth + 1);
  return out;
}

class FillError extends Error {}

/** Check one value against what the field can actually hold, and return it in PDF terms. */
function plan(
  field: ReadField,
  value: FieldValue,
  enciphered?: Map<string, string>,
): { v?: string; as?: Map<number, string>; i?: string } {
  const flags = field.flags;
  if (flags & FF_READ_ONLY) {
    throw new FillError(`field "${field.name}" is read-only`);
  }

  if (field.type === "Sig") {
    throw new FillError(
      `field "${field.name}" is a signature field - jasy creates and reads them, but signing needs a certificate`,
    );
  }
  if (field.type === "Btn" && flags & FF_PUSHBUTTON) {
    throw new FillError(`field "${field.name}" is a push button and holds no value`);
  }

  // ---- buttons: check boxes and radio groups ----
  if (field.type === "Btn") {
    const states = field.onValues ?? [];
    let target: string;
    if (value === null || value === false) target = "Off";
    else if (value === true) {
      if (flags & FF_RADIO) {
        throw new FillError(
          `field "${field.name}" is a radio group - set it to one of ${states.map((s) => `"${s}"`).join(", ")}, not true`,
        );
      }
      // A check box normally declares its "on" name through its appearance states. PDFKit writes no
      // appearance at all, so there is nothing to read - fall back to the value the field already
      // carries, and otherwise to `Yes`, which is the near-universal convention (and what PDFKit itself
      // puts in /V). Refusing here would leave a perfectly fillable form unfillable.
      target =
        states[0] ?? (field.value !== undefined && field.value !== "Off" ? field.value : "Yes");
    } else if (typeof value === "string") {
      // Only reject a state when the file actually declares some; a form without appearances (PDFKit)
      // declares none, and there is then nothing to check the name against.
      if (states.length > 0 && value !== "Off" && !states.includes(value)) {
        throw new FillError(
          `"${value}" is not a state of "${field.name}"; it accepts ${["Off", ...states].map((s) => `"${s}"`).join(", ")}`,
        );
      }
      target = value;
    } else {
      throw new FillError(`field "${field.name}" is a button; give it true, false or a state name`);
    }
    // Every widget shows the target when it owns that state, and Off otherwise - that is what makes a
    // radio group mutually exclusive.
    const as = new Map<number, string>();
    for (const w of field.widgets) {
      if (w.num === undefined) continue;
      as.set(w.num, w.onValues.includes(target) ? target : "Off");
    }
    return { v: `/${escName(target)}`, as };
  }

  // ---- choice fields ----
  if (field.type === "Ch") {
    const options = field.options ?? [];
    const allowed = new Set(options.map((o) => o.value));
    const editable = (flags & FF_EDIT) !== 0;
    const multi = (flags & FF_MULTI_SELECT) !== 0;
    if (value === null) return { v: undefined, i: undefined };
    if (typeof value === "boolean") {
      throw new FillError(
        `field "${field.name}" is a choice field; give it one of ${[...allowed].map((s) => `"${s}"`).join(", ")}, an array, or null`,
      );
    }
    // An empty array is a well-defined request - select nothing - and means the same as null. Without
    // this it fell through and wrote the literal text "undefined" into the field.
    if (Array.isArray(value) && value.length === 0) return { v: undefined, i: undefined };
    const list = Array.isArray(value) ? value : [value];
    if (!multi && list.length > 1) {
      throw new FillError(`field "${field.name}" takes a single value, not ${list.length}`);
    }
    for (const v of list) {
      if (!allowed.has(v) && !editable) {
        throw new FillError(
          `"${v}" is not an option of "${field.name}"; it accepts ${[...allowed].map((s) => `"${s}"`).join(", ")}`,
        );
      }
    }
    const indices = list
      .map((v) => options.findIndex((o) => o.value === v))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    return {
      v: multi
        ? `[${list.map((x) => pdfText(x, enciphered)).join(" ")}]`
        : pdfText(list[0], enciphered),
      i: indices.length > 0 ? `[${indices.join(" ")}]` : undefined,
    };
  }

  // ---- text ----
  if (typeof value === "boolean" || Array.isArray(value)) {
    throw new FillError(`field "${field.name}" is a text field; give it a string or null`);
  }
  if (value === null) return { v: undefined };
  // /MaxLen is what the field itself promises to accept. A viewer enforces it while typing, so writing
  // past it produces a value the user could never have entered - and a comb field draws exactly MaxLen
  // cells, so the surplus has nowhere to go at all. Counting CODE POINTS, not UTF-16 units, or an emoji
  // would count double.
  const length = [...value].length;
  if (field.maxLen !== undefined && length > field.maxLen) {
    throw new FillError(
      `"${field.name}" holds at most ${field.maxLen} characters, but the value has ${length}`,
    );
  }
  return { v: pdfText(value, enciphered) };
}

/**
 * Fill the fields of an existing PDF and return the updated file.
 *
 * @param bytes  the original document
 * @param values field name -> value. Names are the fully qualified ones `readAcroForm` reports.
 */
export async function fillForm(
  bytes: Uint8Array,
  values: Record<string, FieldValue>,
  options: FillOptions = {},
): Promise<FillResult> {
  // Async because an encrypted document has to be deciphered before its field names mean anything, and
  // because the values written back have to be enciphered again with the same file key.
  const doc = await PdfDocument.open(bytes, { password: options.password });

  if (!doc.canReEncrypt) {
    throw new FillError(
      "this PDF is encrypted with RC4 or AES-128; jasy can open it but writes only AES-256, so filling it " +
        "would have to downgrade its protection - refused",
    );
  }

  const form = readAcroForm(doc);
  if (!form) throw new FillError("this PDF has no AcroForm to fill");

  const warnings: string[] = [];
  if (form.hasXfa) {
    warnings.push(
      "This document is an AcroForm/XFA hybrid. The AcroForm side has been filled, but a viewer that " +
        "prefers the XFA packet (Acrobat, in some configurations) may show the old values instead.",
    );
  }
  if (form.recovered) {
    warnings.push(
      "The cross-reference table was unusable and had to be rebuilt by scanning; the file was already damaged.",
    );
  }

  const byName = new Map(form.fields.map((f) => [f.name, f]));
  const unknown = Object.keys(values).filter((n) => !byName.has(n));
  if (unknown.length > 0) {
    throw new FillError(
      `no such field: ${unknown.map((n) => `"${n}"`).join(", ")}. This form has: ` +
        form.fields.map((f) => `"${f.name}"`).join(", "),
    );
  }

  // Every string we are about to WRITE has to go in enciphered. They are known up front - they are the
  // values passed in - so they are done in one pass here rather than threading async through planning.
  const enciphered = new Map<string, string>();
  if (doc.isEncrypted) {
    for (const v of Object.values(values)) {
      for (const text of typeof v === "string" ? [v] : Array.isArray(v) ? v : []) {
        if (enciphered.has(text)) continue;
        const cipher = await doc.encryptForWrite(plainBytes(text));
        if (cipher) enciphered.set(text, hex(cipher));
      }
    }
  }

  const writer = new IncrementalWriter(doc);
  const filled: string[] = [];
  // Emission is deferred: the objects we rewrite carry strings we are NOT changing, and in an encrypted
  // document those have to be enciphered again before they go back in.
  const pending: Array<{
    objNum: number;
    target: PdfDict;
    changes: Record<string, string | undefined>;
  }> = [];

  for (const [name, value] of Object.entries(values)) {
    const field = byName.get(name)!;
    const change = plan(field, value, enciphered);

    if (field.objNum === undefined) {
      throw new FillError(`field "${name}" is not stored as its own object and cannot be updated`);
    }
    const node = doc.getObject(field.objNum);
    if (node === undefined || !isDict(node)) {
      throw new FillError(`field "${name}" could not be re-read for updating`);
    }

    // Collect every change per OBJECT first, because a field and its widget are often the same object
    // and must be rewritten once, not twice - the second write would drop the first one's entries.
    const edits = new Map<number, Record<string, string | undefined>>();
    const editsFor = (n: number) => {
      let e = edits.get(n);
      if (!e) edits.set(n, (e = {}));
      return e;
    };
    Object.assign(editsFor(field.objNum), { V: change.v, I: change.i });

    // A text or choice appearance IS a picture of the value, so the one drawn for the old value is now
    // wrong. Leaving it behind is what made a filled field look empty: the viewer faithfully shows the
    // stale drawing. Removing it puts the file in the same state as one that never had an appearance,
    // where the viewer has to draw from /V and /DA - which is exactly why PDFKit's and react-pdf's
    // filled forms displayed correctly and ours did not.
    // A BUTTON is different: its /AP holds the on/off STATES, both still valid, so it is kept and only
    // /AS moves.
    if (field.type === "Tx" || field.type === "Ch") {
      for (const w of field.widgets) {
        if (w.num !== undefined) editsFor(w.num).AP = undefined;
      }
    }
    for (const [widgetNum, state] of change.as ?? []) {
      editsFor(widgetNum).AS = `/${escName(state)}`;
    }

    for (const [objNum, changes] of edits) {
      const target = objNum === field.objNum ? node : doc.getObject(objNum);
      if (target === undefined || !isDict(target)) continue;
      pending.push({ objNum, target, changes });
    }
    filled.push(name);
  }

  // The /AcroForm dict - and the catalog, when the form sits inline in it - are rewritten as well, so
  // their strings are carried over too and belong in the same pass. NOT reachable today and therefore
  // NOT covered by a test: the only encrypted files we can write into are our own R6 ones, and our
  // /AcroForm dict holds no strings. It matters the moment either changes (a form-level /DA, or writing
  // another scheme), which is why it is wired now rather than left as a trap.
  const acroRef = get(doc.catalog, "AcroForm");
  const acro = doc.resolve(acroRef);
  const rootRef = doc.trailer.map.get("Root");
  const catalog = doc.catalog;
  const alsoRewritten: Array<PdfObject | undefined> =
    options.needAppearances !== false ? [acro, catalog] : [];

  // One pass over every string that will be carried over unchanged. Without this a preserved tooltip or
  // a /DA would be written back in the clear, into a file where nothing else is.
  const carried: StringCipher = new Map();
  if (doc.isEncrypted) {
    for (const target of [...pending.map((p) => p.target), ...alsoRewritten]) {
      for (const str of stringsIn(target)) {
        if (carried.has(str)) continue;
        const cipher = await doc.encryptForWrite(str.bytes);
        if (cipher) carried.set(str, hex(cipher));
      }
    }
  }
  for (const { objNum, target, changes } of pending) {
    writer.update(objNum, withEntries(target, changes, carried));
  }

  // Until appearances are generated here, the viewer has to draw the new values.
  if (options.needAppearances !== false) {
    if (acro !== undefined && isDict(acro)) {
      if (isRef(acroRef)) {
        writer.update(acroRef.num, withEntries(acro, { NeedAppearances: "true" }, carried));
      } else {
        // The form dict can also sit INLINE in the catalog (our own hand-written fixtures do). Then the
        // catalog is what has to be rewritten - skipping it left the new values undrawn.
        if (isRef(rootRef) && catalog !== undefined && isDict(catalog)) {
          const inlined = withEntries(acro, { NeedAppearances: "true" }, carried);
          writer.update(rootRef.num, withEntries(catalog, { AcroForm: inlined }, carried));
        }
      }
    }
  }

  return { bytes: writer.save(), warnings, filled };
}

export { FillError };
export type { PdfObject };
