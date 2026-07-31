import { PdfDocument } from "./document.ts";
import { readAcroForm, type ReadField } from "./acroform-reader.ts";
import { carryStrings, IncrementalWriter, serialize, type StringCipher } from "./writer.ts";
import { bakeAppearance, bakeButtonStates, fontMetrics, readLook } from "./appearance.ts";
import { flattenInto } from "./flatten.ts";
import type { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { getArrayBuffer } from "../utils/utf8-to-windows1252-encoder.ts";
import { get, isDict, isRef, type PdfDict, type PdfObject, type PdfRef } from "./objects.ts";

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
  /** Ceiling on what ONE stream may inflate to, in bytes (default 64 MB) - the zip-bomb guard. */
  maxStreamSize?: number;
  /**
   * Draw the new value into the field's appearance (default `true`), the same way jasy bakes one when it
   * CREATES a field - so the value is visible in any viewer, not only in one that honours
   * `/NeedAppearances`. Set `false` to leave the drawing to the viewer instead.
   */
  fieldAppearances?: boolean;
  /**
   * Ask the viewer to draw the values itself, by setting `/NeedAppearances true` (default `true`).
   *
   * The two options answer the same question and exactly one of them ends up applying: when we DID
   * bake, the flag is written as `false`, because a form that still asks for regeneration gets it and
   * the viewer throws our drawing away. Turning BOTH off is refused - see `fillForm`.
   */
  needAppearances?: boolean;
  /**
   * Flatten the form after filling it (default `false`): the values become ordinary page content and
   * the fields stop being editable. The whole form is flattened, not only the names in `values` - a
   * document where some fields are frozen and others are not is the surprising outcome, and
   * `flattenForm(bytes, { fields })` is there for anyone who wants that on purpose.
   *
   * Filling and flattening in one call produces ONE incremental update rather than two, so the file
   * stays smaller than calling them in sequence - and the result is identical either way.
   */
  flatten?: boolean;
}

export interface FillResult {
  bytes: Uint8Array;
  /** Things worth knowing that are not errors - an XFA hybrid, a rebuilt index. */
  warnings: string[];
  /** The names actually written. */
  filled: string[];
  /** The names turned into page content, when `flatten` was asked for. Empty otherwise. */
  flattened: string[];
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
/**
 * Draw the field again for its NEW value and append the XObject, returning its object number. Falls back
 * to `undefined` when the widget does not say enough about itself to draw it - then the caller drops the
 * picture and the viewer takes over, which is always safe.
 */
async function bakeFor(
  doc: PdfDocument,
  writer: IncrementalWriter,
  field: ReadField,
  widgetNum: number,
  change: { v?: string; text?: string; texts?: string[] },
  metrics: PDFObjectManager,
): Promise<number | undefined> {
  const look = readLook(doc, doc.getObject(widgetNum), field);
  if (look === undefined || look.width <= 0 || look.height <= 0) return undefined;
  const face = bakeAppearance(look, field, change.text, change.texts, metrics);
  if (face === undefined) return undefined;
  const bbox = face.bbox.map((n: number) => Number(n.toFixed(2))).join(" ");
  const encoded = new Uint8Array(getArrayBuffer(face.content));
  const plain = (await doc.encryptForWrite(encoded)) ?? encoded;
  return writer.add({
    dict: `/Type /XObject /Subtype /Form /BBox [${bbox}] /Resources << /Font << /Helv ${writer.helv()} 0 R >> >>`,
    // Windows-1252, NOT UTF-8: the appearance draws with /Helv, a WinAnsiEncoding font, so an "ä" is one
    // byte 0xE4. Encoding it as UTF-8 puts two bytes in and the viewer faithfully draws two glyphs.
    // And in an encrypted document the stream is a stream like any other - it has to be enciphered too.
    data: plain,
  });
}

/** The `/AP` dictionary for a button we had to draw ourselves, or `undefined` if we cannot. */
async function bakeStatesFor(
  doc: PdfDocument,
  writer: IncrementalWriter,
  field: ReadField,
  widgetNum: number,
  state: string,
): Promise<{ ap: string; states: Map<string, number> } | undefined> {
  const look = readLook(doc, doc.getObject(widgetNum), field);
  if (look === undefined || look.width <= 0 || look.height <= 0) return undefined;
  const radio = (field.flags & FF_RADIO) !== 0;
  const on = state === "Off" ? (field.onValues?.[0] ?? "Yes") : state;
  const faces = bakeButtonStates(look, on, radio);
  const bbox = faces.bbox.map((n) => Number(n.toFixed(2))).join(" ");
  const write = async (content: string) => {
    const encoded = new Uint8Array(getArrayBuffer(content));
    return writer.add({
      dict: `/Type /XObject /Subtype /Form /BBox [${bbox}]`,
      data: (await doc.encryptForWrite(encoded)) ?? encoded,
    });
  };
  // The object numbers come back too: a flatten in the same pass stamps one of these two states.
  const onNum = await write(faces.on);
  const offNum = await write(faces.off);
  return {
    ap: `<< /N << /${escName(on)} ${onNum} 0 R /Off ${offNum} 0 R >> >>`,
    states: new Map([
      [on, onNum],
      ["Off", offNum],
    ]),
  };
}

/** The appearance a widget ALREADY carries for one of its states, from `/AP /N /<state>`. */
function stateAppearance(doc: PdfDocument, widgetNum: number, state: string): PdfRef | undefined {
  const states = doc.resolve(get(doc.resolve(get(doc.getObject(widgetNum), "AP")), "N"));
  if (states === undefined || !isDict(states)) return undefined;
  const chosen = states.map.get(state);
  return isRef(chosen) ? chosen : undefined;
}

class FillError extends Error {}

/** Check one value against what the field can actually hold, and return it in PDF terms. */
function plan(
  field: ReadField,
  value: FieldValue,
  enciphered?: Map<string, string>,
): { v?: string; as?: Map<number, string>; i?: string; text?: string; texts?: string[] } {
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
    //
    // A widget that declares NO states at all (PDFKit and react-pdf ship none) owns nothing, so the test
    // above would leave every box Off however it was filled. There the target is simply the state, since
    // it is the one being drawn. Not for a radio group: with no states there is no way to tell its
    // buttons apart, and turning them all on would be worse than leaving them alone.
    const declaresNothing = states.length === 0 && (flags & FF_RADIO) === 0;
    const as = new Map<number, string>();
    for (const w of field.widgets) {
      if (w.num === undefined) continue;
      as.set(w.num, declaresNothing || w.onValues.includes(target) ? target : "Off");
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
      text: list[0],
      texts: list,
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
  return { v: pdfText(value, enciphered), text: value };
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
  // Two option combinations describe a document nobody wants. Refused before the file is opened, since
  // the answer does not depend on it.
  if (options.fieldAppearances === false && options.needAppearances === false) {
    throw new FillError(
      "fieldAppearances and needAppearances are both false, which leaves the values invisible: nothing " +
        "is drawn by jasy and the viewer is not asked to draw anything either. Turn one of them on",
    );
  }
  if (options.flatten === true && options.fieldAppearances === false) {
    throw new FillError(
      "flatten needs fieldAppearances: flattening freezes the picture a field shows, and with " +
        "fieldAppearances false there is no picture of the new value to freeze",
    );
  }

  // Async because an encrypted document has to be deciphered before its field names mean anything, and
  // because the values written back have to be enciphered again with the same file key.
  const doc = await PdfDocument.open(bytes, {
    password: options.password,
    maxStreamSize: options.maxStreamSize,
  });

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
  const bake = options.fieldAppearances !== false;
  // One metrics instance for the whole fill, not one per field and not one at module scope.
  const metrics = bake ? fontMetrics() : undefined;
  // Only collected when a flatten follows in this same pass; see `FreshAppearances` for why it exists.
  const fresh = options.flatten ? new Map<number, PdfRef>() : undefined;
  // A widget we could not draw has no picture at all, so the viewer must be asked after all.
  let someBakeFailed = false;
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
    // stale drawing.
    //
    // So it is DRAWN AGAIN, from the widget's own style - which is what jasy does when it creates a
    // field, and what makes the value visible without the viewer having to redraw anything. Opt out with
    // `fieldAppearances: false` and the old behaviour returns: drop the picture, set /NeedAppearances,
    // let the viewer draw.
    // A BUTTON is different either way: its /AP holds the on/off STATES, both still valid, so it is kept
    // and only /AS moves.
    if (field.type === "Tx" || field.type === "Ch") {
      for (const w of field.widgets) {
        if (w.num === undefined) continue;
        const baked =
          bake && metrics ? await bakeFor(doc, writer, field, w.num, change, metrics) : undefined;
        if (bake && baked === undefined) someBakeFailed = true;
        editsFor(w.num).AP = baked !== undefined ? `<< /N ${baked} 0 R >>` : undefined;
        if (baked !== undefined) fresh?.set(w.num, { kind: "ref", num: baked, gen: 0 });
      }
    }
    for (const [widgetNum, state] of change.as ?? []) {
      editsFor(widgetNum).AS = `/${escName(state)}`;
      // A button whose widget ships NO state pictures (PDFKit, react-pdf write none) stays an empty box
      // in anything that does not redraw - and cannot be flattened at all. Draw the two states once.
      if (bake && !field.widgets.find((w) => w.num === widgetNum)?.hasAppearance) {
        const drawn = await bakeStatesFor(doc, writer, field, widgetNum, state);
        if (drawn !== undefined) {
          editsFor(widgetNum).AP = drawn.ap;
          const num = drawn.states.get(state);
          if (num !== undefined) fresh?.set(widgetNum, { kind: "ref", num, gen: 0 });
        }
      } else {
        // The widget keeps its own pictures and only /AS moves, so the state to stamp is the NEW one -
        // reading /AS back out of the document would give the state before this fill.
        const ref = stateAppearance(doc, widgetNum, state);
        if (ref !== undefined) fresh?.set(widgetNum, ref);
      }
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
    bake || options.needAppearances !== false ? [acro, catalog] : [];

  // One pass over every string that will be carried over unchanged. Without this a preserved tooltip or
  // a /DA would be written back in the clear, into a file where nothing else is.
  const carried = await carryStrings(doc, [...pending.map((p) => p.target), ...alsoRewritten]);
  for (const { objNum, target, changes } of pending) {
    writer.update(objNum, withEntries(target, changes, carried));
  }

  // The flag and the pictures are two answers to the same question, so exactly one of them applies.
  // When we DID draw, the flag has to go: a form that still asks for regeneration gets it, and the
  // viewer throws our drawing away and redraws from /DA - which is how PDFKit's forms kept asking for a
  // ZapfDingbats they do not ship.
  // With a flatten following there is nothing left to answer it for, and that pass rewrites the same
  // /AcroForm dictionary anyway.
  const needAppearances = bake && !someBakeFailed ? "false" : "true";
  if (!options.flatten && (bake || options.needAppearances !== false)) {
    if (acro !== undefined && isDict(acro)) {
      if (isRef(acroRef)) {
        writer.update(
          acroRef.num,
          withEntries(acro, { NeedAppearances: needAppearances }, carried),
        );
      } else {
        // The form dict can also sit INLINE in the catalog (our own hand-written fixtures do). Then the
        // catalog is what has to be rewritten - skipping it left the new values undrawn.
        if (isRef(rootRef) && catalog !== undefined && isDict(catalog)) {
          const inlined = withEntries(acro, { NeedAppearances: needAppearances }, carried);
          writer.update(rootRef.num, withEntries(catalog, { AcroForm: inlined }, carried));
        }
      }
    }
  }

  // Same writer, so the whole operation stays one incremental update. Last, because it freezes the
  // pictures drawn above.
  const flattened = options.flatten
    ? await flattenInto(doc, writer, form.fields, carried, fresh)
    : [];

  return { bytes: writer.save(), warnings, filled, flattened };
}

export { FillError };
export type { PdfObject };
