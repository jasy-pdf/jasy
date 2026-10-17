// Generates the attachment fixtures. pdf-lib and PDFKit are independent producers; the third file is
// built by hand because no library writes the rarer structures (a nested name tree, the old filters).
// Run from a scratch directory that has `pdf-lib@1.17.1` and `pdfkit@0.19.1` installed:
//   node gen.mjs <out-dir>
// The hand-built file is checked against poppler (`pdfdetach -list`) - an independent reader.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { PDFDocument as PdfLibDocument, AFRelationship } from "pdf-lib";
import PDFKitDocument from "pdfkit";

const out = process.argv[2] ?? ".";
const DATE = new Date(Date.UTC(2026, 9, 17, 10, 30, 0));
const XML = new TextEncoder().encode('<?xml version="1.0"?><invoice><id>INV-1</id></invoice>\n');
// Every byte value, twice - an attachment comes back EXACTLY, not as text.
const BINARY = Uint8Array.from({ length: 512 }, (_, i) => i % 256);

// ---- 1. pdf-lib: xref stream + object streams, AFRelationship, a Unicode name ---------------------
async function pdflib() {
  const doc = await PdfLibDocument.create();
  doc.addPage([200, 200]);
  await doc.attach(XML, "invoice.xml", {
    mimeType: "application/xml",
    description: "The invoice data",
    creationDate: DATE,
    modificationDate: DATE,
    afRelationship: AFRelationship.Source,
  });
  await doc.attach(BINARY, "Übersicht – €.bin", {
    mimeType: "application/octet-stream",
    description: "Binärdaten",
    afRelationship: AFRelationship.Data,
  });
  writeFileSync(`${out}/pdflib-attachments.pdf`, await doc.save()); // object streams by default
}

// ---- 2. PDFKit: name tree, a page annotation, and the same encrypted ------------------------------
function pdfkit(file, options = {}) {
  return new Promise((resolve) => {
    const doc = new PDFKitDocument({ size: [200, 200], ...options });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => {
      writeFileSync(`${out}/${file}`, Buffer.concat(chunks));
      resolve();
    });
    doc.file(Buffer.from(XML), {
      name: "invoice.xml",
      type: "application/xml",
      description: "The invoice data",
      creationDate: DATE,
      modifiedDate: DATE,
      relationship: "Source",
    });
    // Attached to a page, not to the document.
    doc.fileAnnotation(20, 20, 20, 20, {
      src: Buffer.from(BINARY),
      name: "on-the-page.bin",
      type: "application/octet-stream",
      description: "Attached to page 1",
    });
    doc.end();
  });
}

// ---- 3. By hand: nested name tree, every standard filter, odd names --------------------------------
const latin1 = (s) => Buffer.from(s, "latin1");

function asciiHex(bytes) {
  return latin1(
    Buffer.from(bytes)
      .toString("hex")
      .replace(/(.{60})/g, "$1\n") + ">",
  );
}

function ascii85(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((k) => bytes[i + k] ?? 0);
    const n = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    const take = Math.min(4, bytes.length - i);
    if (n === 0 && take === 4) {
      s += "z";
      continue;
    }
    let v = n;
    const digits = [];
    for (let d = 0; d < 5; d++) {
      digits.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    s += digits.slice(0, take + 1).join("");
  }
  return latin1(s.replace(/(.{70})/g, "$1\n") + "~>");
}

function runLength(bytes) {
  const outBytes = [];
  for (let i = 0; i < bytes.length; ) {
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === bytes[i] && run < 128) run++;
    if (run > 1) {
      outBytes.push(257 - run, bytes[i]);
      i += run;
    } else {
      let lit = 1;
      while (
        i + lit < bytes.length &&
        lit < 128 &&
        !(i + lit + 1 < bytes.length && bytes[i + lit] === bytes[i + lit + 1])
      )
        lit++;
      outBytes.push(lit - 1, ...bytes.subarray(i, i + lit));
      i += lit;
    }
  }
  outBytes.push(128);
  return Uint8Array.from(outBytes);
}

// LZW as PDF writes it: 9-12 bit codes, 256 clears, 257 ends, EarlyChange 1 (the width grows one code early).
function lzw(bytes) {
  const outBits = [];
  let width = 9;
  let dict = new Map();
  let next = 258;
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
    next = 258;
    width = 9;
  };
  const emit = (code) => {
    for (let b = width - 1; b >= 0; b--) outBits.push((code >> b) & 1);
  };
  reset();
  emit(256);
  let w = "";
  for (const byte of bytes) {
    const c = String.fromCharCode(byte);
    if (dict.has(w + c)) {
      w += c;
      continue;
    }
    emit(dict.get(w));
    dict.set(w + c, next++);
    if (next + 1 > 1 << width) {
      if (width === 12) {
        emit(256);
        reset();
      } else width++;
    }
    w = c;
  }
  if (w) emit(dict.get(w));
  emit(257);
  while (outBits.length % 8) outBits.push(0);
  const res = new Uint8Array(outBits.length / 8);
  for (let i = 0; i < res.length; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | outBits[i * 8 + b];
    res[i] = v;
  }
  return res;
}

const md5 = (bytes) => createHash("md5").update(bytes).digest();
const hex = (bytes) => `<${Buffer.from(bytes).toString("hex")}>`;
const utf16 = (s) => {
  const b = Buffer.from(s, "utf16le").swap16();
  return `<FEFF${b.toString("hex")}>`;
};

function handmade() {
  // A text long enough that every filter does real work.
  const text = new TextEncoder().encode("Hello, attachments! ".repeat(40) + "Ende.\n");
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const stream = (dict, data) =>
    Buffer.concat([
      latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`),
      Buffer.from(data),
      latin1("\nendstream"),
    ]);
  const file = (filter, data, extra = "") =>
    add(
      stream(
        `/Type /EmbeddedFile /Subtype /text#2Fplain ${filter} /Params << /Size ${text.length} /CheckSum ${hex(md5(text))} /ModDate (D:20261017103000+02'00') >> ${extra}`,
        data,
      ),
    );
  const spec = (name, ef, more = "") =>
    add(
      latin1(`<< /Type /Filespec /F (${name}) /UF ${utf16(name)} /EF << /F ${ef} 0 R >> ${more}>>`),
    );

  const fHex = file("/Filter /ASCIIHexDecode", asciiHex(text));
  const f85 = file("/Filter /ASCII85Decode", ascii85(text));
  const fLzw = file("/Filter /LZWDecode", lzw(text));
  const fRl = file("/Filter /RunLengthDecode", runLength(text));
  const fChain = file("/Filter [/ASCII85Decode /FlateDecode]", ascii85(deflateSync(text)));
  // Declares a checksum the bytes do not have - a reader must not hand these back as the file.
  const fBad = add(
    stream(
      `/Type /EmbeddedFile /Params << /Size ${text.length} /CheckSum ${hex(new Uint8Array(16))} >>`,
      text,
    ),
  );
  const fAfOnly = file("", text);

  const sHex = spec("hex.txt", fHex, "/Desc (ASCIIHex) ");
  const s85 = spec("a85.txt", f85, "/Desc (ASCII85) ");
  const sLzw = spec("lzw.txt", fLzw, "/Desc (LZW) /AFRelationship /Data ");
  const sRl = spec("runlength.txt", fRl, "/Desc (RunLength) ");
  // Only /F, in PDFDocEncoding: byte 0x84 is an em dash there (Latin-1 would make it a control char).
  const sDoc = add(
    latin1(
      `<< /Type /Filespec /F (doc\x84enc.txt) /EF << /F ${fChain} 0 R >> /Desc (Chained filters) >>`,
    ),
  );
  const sBad = spec("bad-checksum.txt", fBad);
  // Name and description as UTF-8 with its BOM (PDF 2.0 text strings).
  const sAf = add(
    latin1(
      `<< /Type /Filespec /UF <EFBBBF${Buffer.from("nur-in-AF-ü.txt").toString("hex")}> /EF << /F ${fAfOnly} 0 R >> /AFRelationship /Supplement >>`,
    ),
  );

  // Nested name tree: root -> two leaves, keys sorted as the format requires.
  const leafA = add(
    latin1(
      `<< /Limits [(a85) (hex)] /Names [(a85) ${s85} 0 R (bad) ${sBad} 0 R (hex) ${sHex} 0 R] >>`,
    ),
  );
  const leafB = add(
    latin1(
      `<< /Limits [(lzw) (zz-inline)] /Names [(lzw) ${sLzw} 0 R (pdfdoc) ${sDoc} 0 R (rl) ${sRl} 0 R (zz-inline) << /Type /Filespec /F (inline.txt) /EF << /F ${fHex} 0 R >> >>] >>`,
    ),
  );
  const tree = add(latin1(`<< /Kids [${leafA} 0 R ${leafB} 0 R] >>`));

  const content = add(stream("", latin1("")));
  const page = objects.length + 2;
  const pages = add(latin1(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`));
  add(
    latin1(
      `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 200 200] /Contents ${content} 0 R >>`,
    ),
  );
  // /AF lists one file the tree has too (one entry, not two) and one only it has.
  const catalog = add(
    latin1(
      `<< /Type /Catalog /Pages ${pages} 0 R /Names << /EmbeddedFiles ${tree} 0 R >> /AF [${sLzw} 0 R ${sAf} 0 R] >>`,
    ),
  );

  const parts = [latin1("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  const offsets = [];
  let at = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(at);
    const chunk = Buffer.concat([
      latin1(`${i + 1} 0 obj\n`),
      Buffer.from(body),
      latin1("\nendobj\n"),
    ]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`),
  ].join("");
  parts.push(
    latin1(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${at}\n%%EOF\n`,
    ),
  );
  writeFileSync(`${out}/handmade-attachments.pdf`, Buffer.concat(parts));
}

await pdflib();
await pdfkit("pdfkit-attachments.pdf");
await pdfkit("pdfkit-attachments-aes256.pdf", {
  pdfVersion: "1.7ext3",
  userPassword: "geheim",
  ownerPassword: "geheim-owner",
});
handmade();
