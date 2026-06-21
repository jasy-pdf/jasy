import { inflateSync } from "node:zlib";

// PDF → embedded XML. Pulls the e-invoice XML (factur-x.xml) out of a ZUGFeRD / XRechnung PDF/A-3.
// Minimal by design: we do NOT parse the whole PDF (no pdf.js). We resolve the /EmbeddedFile stream
// object, read its bytes, and FlateDecode-inflate them when filtered. jasy *wrote* the PDF - here we
// read the embedded part back out. The foundation the whole CLI hangs off (read → parse → validate).

/** The embedded XML of a ZUGFeRD / XRechnung PDF, as a UTF-8 string. Throws if the PDF carries none. */
export function extractEmbeddedXml(pdf: Uint8Array): string {
  const buf = Buffer.from(pdf);
  const s = buf.toString("latin1"); // 1 byte per char → string index == byte offset

  const objNum = findEmbeddedFileObject(s);
  if (objNum === null) {
    throw new Error("No embedded XML found - is this a ZUGFeRD / Factur-X PDF?");
  }

  const obj = locateObject(s, objNum);
  if (!obj) throw new Error(`Embedded-file object ${objNum} not found in the PDF.`);

  const bytes = readStream(buf, s, obj.dataStart, obj.dict);
  const flated = /\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(obj.dict);
  return (flated ? inflateSync(bytes) : bytes).toString("utf-8");
}

// The e-invoice XML's EmbeddedFile object number. A PDF may embed SEVERAL files (e.g. a tool also
// attaches its own gobl.json / source) - so we collect every Filespec and pick the invoice XML by name
// (factur-x.xml / zugferd-invoice.xml / xrechnung.xml / order-x.xml), then any .xml, then the first.
function findEmbeddedFileObject(s: string): number | null {
  const specs: { obj: number; name: string }[] = [];
  const efRe = /\/EF\s*<<[^>]*?\/(?:UF|F)\s+(\d+)\s+0\s+R/g;
  for (let m = efRe.exec(s); m; m = efRe.exec(s)) {
    specs.push({ obj: Number(m[1]), name: filespecName(s, m.index) });
  }
  if (specs.length) {
    const invoiceXml = /(factur-x|zugferd-invoice|xrechnung|order-x|cii)\.xml$/i;
    const pick =
      specs.find((sp) => invoiceXml.test(sp.name)) ??
      specs.find((sp) => /\.xml$/i.test(sp.name)) ??
      specs[0];
    return pick.obj;
  }

  const t = s.search(/\/Type\s*\/EmbeddedFile/);
  if (t >= 0) {
    // the enclosing "N 0 obj" is the last object definition before the /Type
    const m = s.slice(0, t).match(/(\d+)\s+0\s+obj(?![\s\S]*\d+\s+0\s+obj)/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The /F or /UF filename of the Filespec that owns the /EF at `idx` (look just before it, else after). */
function filespecName(s: string, idx: number): string {
  const before = s.slice(Math.max(0, idx - 400), idx).match(/\/(?:UF|F)\s*\(([^)]*)\)[^(]*$/);
  if (before) return before[1];
  const after = s.slice(idx, idx + 400).match(/\/(?:UF|F)\s*\(([^)]*)\)/);
  return after ? after[1] : "";
}

function locateObject(s: string, objNum: number): { dict: string; dataStart: number } | null {
  const m = new RegExp(`(?:^|[^0-9])${objNum}\\s+0\\s+obj`).exec(s);
  if (!m) return null;
  const streamKw = s.indexOf("stream", m.index + m[0].length);
  if (streamKw < 0) return null;
  const dict = s.slice(m.index + m[0].length, streamKw);
  // "stream" is followed by CRLF or LF before the data begins
  let dataStart = streamKw + "stream".length;
  if (s[dataStart] === "\r") dataStart++;
  if (s[dataStart] === "\n") dataStart++;
  return { dict, dataStart };
}

// Stream bytes: the direct /Length when present (precise), else everything up to "endstream".
function readStream(buf: Buffer, s: string, dataStart: number, dict: string): Buffer {
  const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/); // direct length, not an indirect ref
  if (len) return buf.subarray(dataStart, dataStart + Number(len[1]));

  let end = s.indexOf("endstream", dataStart);
  if (s[end - 1] === "\n") end--;
  if (s[end - 1] === "\r") end--;
  return buf.subarray(dataStart, end);
}
