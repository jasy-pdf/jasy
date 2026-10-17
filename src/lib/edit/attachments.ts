import { md5 } from "../utils/md5.ts";
import type { PdfDocument } from "./document.ts";
import {
  get,
  isDict,
  isRef,
  isStream,
  isString,
  nameOf,
  numberOf,
  textStringOf,
  type PdfDict,
  type PdfObject,
  type PdfStream,
} from "./objects.ts";

/**
 * The files embedded in a PDF - every one of them, with everything the file says about it, and its
 * exact bytes on demand.
 *
 * Attachments live in three places, and real files use all three: the document's `/EmbeddedFiles` name
 * tree (a tree - large ones split into `/Kids`), the `/AF` arrays of PDF/A-3 (the catalog's, and a page's),
 * and `FileAttachment` annotations on pages. One file spec reached from two places is ONE attachment;
 * two different file specs with the same name are TWO - telling those apart is the caller's business,
 * so nothing is merged by name.
 */

/** Thrown when an attachment's data cannot be handed back exactly as it was embedded. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

/** Where an attachment hangs: the document, or a page (0-based), through an annotation or its `/AF`. */
export type AttachmentLocation = { kind: "document" } | { kind: "page"; page: number };

export interface Attachment {
  /** The file's name: `/UF`, else `/F`, else its key in the name tree. */
  name: string;
  /** Its key in the `/EmbeddedFiles` name tree, when it is listed there. */
  key?: string;
  description?: string;
  /** The media type the file declares (`/Subtype` of the embedded stream), e.g. `application/xml`. */
  mimeType?: string;
  /** `/AFRelationship` - `Source`, `Data`, `Alternative`, `Supplement`, `Unspecified`, ... */
  relationship?: string;
  /** The size the file DECLARES (`/Params /Size`). Informative only: `bytes()` is bounded by what it decodes to. */
  declaredSize?: number;
  created?: Date;
  modified?: Date;
  /** The MD5 the file declares (`/Params /CheckSum`); `bytes()` checks the data against it. */
  checksum?: Uint8Array;
  /** Every place it hangs - one file spec may be listed for the document AND annotated on a page. */
  locations: AttachmentLocation[];
  /** The file specification's object, when it is one - stable identity within this document. */
  ref?: { num: number; gen: number };
  /** The file's exact bytes: deciphered, every filter decoded, checked against its checksum. */
  bytes(): Uint8Array;
  /** The bytes as UTF-8 text, a byte-order mark dropped. */
  text(): string;
}

/** Every attachment in the document, in the order: name tree, catalog `/AF`, then page by page. */
export function readAttachments(doc: PdfDocument): Attachment[] {
  const out: Attachment[] = [];
  const byRef = new Map<number, Attachment>();
  const add = (spec: PdfObject | undefined, where: AttachmentLocation, key?: string) => {
    const known = isRef(spec) ? byRef.get(spec.num) : undefined;
    if (known) {
      const same = known.locations.some(
        (l) =>
          l.kind === where.kind &&
          (l.kind === "document" || l.page === (where as { page: number }).page),
      );
      if (!same) known.locations.push(where);
      if (key !== undefined) known.key ??= key;
      return;
    }
    const attachment = toAttachment(doc, spec, where, key);
    if (!attachment) return;
    out.push(attachment);
    if (isRef(spec)) byRef.set(spec.num, attachment);
  };

  const catalog = doc.catalog;
  const tree = doc.lookup(doc.lookup(catalog, "Names"), "EmbeddedFiles");
  walkNameTree(doc, tree, (key, spec) => add(spec, { kind: "document" }, key));
  for (const spec of arrayOf(doc, doc.lookup(catalog, "AF"))) add(spec, { kind: "document" });

  pagesOf(doc).forEach((page, index) => {
    const where: AttachmentLocation = { kind: "page", page: index };
    for (const spec of arrayOf(doc, doc.lookup(page, "AF"))) add(spec, where);
    for (const annot of arrayOf(doc, doc.lookup(page, "Annots"))) {
      const dict = doc.resolve(annot);
      if (nameOf(get(dict, "Subtype")) === "FileAttachment") add(get(dict, "FS"), where);
    }
  });
  return out;
}

/** One file specification as an attachment, or nothing when it embeds no file (a mere reference). */
function toAttachment(
  doc: PdfDocument,
  specRef: PdfObject | undefined,
  where: AttachmentLocation,
  key: string | undefined,
): Attachment | undefined {
  const spec = doc.resolve(specRef);
  if (spec === undefined || !isDict(spec)) return undefined;
  const ef = doc.resolve(get(spec, "EF"));
  const fileRef = get(ef, "F") ?? get(ef, "UF");
  const file = doc.resolve(fileRef);
  if (file === undefined || !isStream(file)) return undefined;

  const params = doc.resolve(get(file, "Params"));
  const name =
    textStringOf(doc.resolve(get(spec, "UF"))) ??
    textStringOf(doc.resolve(get(spec, "F"))) ??
    key ??
    "";
  const checksum = doc.resolve(get(params, "CheckSum"));
  const declared = isString(checksum) ? checksum.bytes : undefined;

  let decoded: Uint8Array | undefined;
  const bytes = (): Uint8Array => {
    if (decoded) return decoded;
    let data: Uint8Array;
    try {
      data = doc.streamData(file as PdfStream, true);
    } catch (e) {
      throw new AttachmentError(
        `the attachment "${name}" cannot be read: ${String((e as Error)?.message ?? e).replace(/^@jasy\/pdf: /, "")}`,
      );
    }
    if (declared && declared.length === 16 && !sameBytes(md5(data), declared)) {
      throw new AttachmentError(
        `the attachment "${name}" does not match its own checksum - it was changed or damaged after ` +
          `it was embedded`,
      );
    }
    return (decoded = data);
  };

  return {
    name,
    key,
    description: textStringOf(doc.resolve(get(spec, "Desc"))),
    mimeType: nameOf(get(file, "Subtype")),
    relationship: nameOf(get(spec, "AFRelationship")),
    declaredSize: numberOf(doc.resolve(get(params, "Size"))),
    created: dateOf(doc.resolve(get(params, "CreationDate"))),
    modified: dateOf(doc.resolve(get(params, "ModDate"))),
    checksum: declared,
    locations: [where],
    ref: isRef(specRef) ? { num: specRef.num, gen: specRef.gen } : undefined,
    bytes,
    text: () => {
      const b = bytes();
      const bom = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
      return new TextDecoder().decode(bom ? b.subarray(3) : b);
    },
  };
}

/** A name tree's leaves in key order, through `/Kids` - bounded, and a node reached twice is read once. */
function walkNameTree(
  doc: PdfDocument,
  root: PdfObject | undefined,
  visit: (key: string, value: PdfObject | undefined) => void,
): void {
  const seen = new Set<number>();
  const node = (n: PdfObject | undefined, depth: number): void => {
    if (depth > 64) return;
    if (isRef(n)) {
      if (seen.has(n.num)) return;
      seen.add(n.num);
    }
    const dict = doc.resolve(n);
    if (dict === undefined || !isDict(dict)) return;
    const names = doc.resolve(get(dict, "Names"));
    if (Array.isArray(names)) {
      for (let i = 0; i + 1 < names.length; i += 2) {
        visit(textStringOf(doc.resolve(names[i])) ?? "", names[i + 1]);
      }
    }
    for (const kid of arrayOf(doc, get(dict, "Kids"))) node(kid, depth + 1);
  };
  node(root, 0);
}

/** The page dictionaries in document order - bounded, a page tree node reached twice is read once. */
function pagesOf(doc: PdfDocument): PdfDict[] {
  const out: PdfDict[] = [];
  const seen = new Set<number>();
  const node = (n: PdfObject | undefined, depth: number): void => {
    if (depth > 64) return;
    if (isRef(n)) {
      if (seen.has(n.num)) return;
      seen.add(n.num);
    }
    const dict = doc.resolve(n);
    if (dict === undefined || !isDict(dict)) return;
    const kids = doc.lookup(dict, "Kids");
    if (Array.isArray(kids)) for (const kid of kids) node(kid, depth + 1);
    else out.push(dict);
  };
  node(get(doc.catalog, "Pages"), 0);
  return out;
}

const arrayOf = (doc: PdfDocument, o: PdfObject | undefined): PdfObject[] => {
  const a = doc.resolve(o);
  return Array.isArray(a) ? a : [];
};

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** A PDF date, `D:YYYYMMDDHHmmSSOHH'mm`, everything after the year optional. */
function dateOf(o: PdfObject | undefined): Date | undefined {
  const s = textStringOf(o);
  const m =
    s &&
    /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(
      s.trim(),
    );
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", sign, oh = "00", om = "00"] = m;
  const utc = Date.UTC(+y!, +mo - 1, +d, +h, +mi, +sec);
  const offset = sign === "+" || sign === "-" ? (sign === "+" ? 1 : -1) * (+oh * 60 + +om) : 0;
  return new Date(utc - offset * 60_000);
}
