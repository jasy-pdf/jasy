import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PdfDocument, PdfEncryptedError } from "../../../src/lib/edit/document.ts";
import { readAttachments, AttachmentError } from "../../../src/lib/edit/attachments.ts";
import { Document, Page, Text, renderToBytes } from "../../../src/lib/api/index.ts";
import { createSecurityHandler } from "../../../src/lib/crypto/security-handler.ts";

// Every attachment, with everything the file says about it, and its exact bytes. Read against three
// producers (pdf-lib, PDFKit, a hand-built file - see tests/fixtures/attachments/README.md) and against
// our own writer, so it is never only "we can read what we wrote".

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/attachments/${name}.pdf`));
const open = (name: string, password?: string) => PdfDocument.open(fixture(name), { password });

const XML = '<?xml version="1.0"?><invoice><id>INV-1</id></invoice>\n';
const BINARY = Uint8Array.from({ length: 512 }, (_, i) => i % 256);
const TEXT = "Hello, attachments! ".repeat(40) + "Ende.\n";
const DATE = new Date(Date.UTC(2026, 9, 17, 10, 30, 0));

describe("pdf-lib - xref stream, object streams", () => {
  it("lists every attachment with what the file says about it", async () => {
    const doc = await open("pdflib-attachments");
    expect(doc.usesXrefStream).toBe(true);
    const [xml, bin] = readAttachments(doc);
    expect(xml).toMatchObject({
      name: "invoice.xml",
      key: "invoice.xml",
      description: "The invoice data",
      mimeType: "application/xml",
      relationship: "Source",
      declaredSize: 55,
      created: DATE,
      modified: DATE,
      locations: [{ kind: "document" }],
    });
    expect(bin).toMatchObject({
      name: "Übersicht – €.bin",
      description: "Binärdaten",
      relationship: "Data",
    });
  });

  it("hands back the exact bytes - text and every byte value", async () => {
    const [xml, bin] = readAttachments(await open("pdflib-attachments"));
    expect(xml!.text()).toBe(XML);
    expect(bin!.bytes()).toEqual(BINARY);
  });
});

describe("PDFKit - name tree, a page annotation, encryption", () => {
  it("names every place a file hangs - listed for the document AND annotated on a page", async () => {
    const [, onPage] = readAttachments(await open("pdfkit-attachments"));
    expect(onPage!.name).toBe("on-the-page.bin");
    expect(onPage!.locations).toEqual([{ kind: "document" }, { kind: "page", page: 0 }]);
    expect(onPage!.bytes()).toEqual(BINARY);
  });

  it("reads the same attachments from the AES-256 file, with its password", async () => {
    // PDFKit leaves the name-tree key in the clear inside an encrypted file; it is read as it stands.
    const plain = readAttachments(await open("pdfkit-attachments"));
    const encrypted = readAttachments(await open("pdfkit-attachments-aes256", "geheim"));
    expect(encrypted.map((a) => [a.name, a.mimeType, a.locations])).toEqual(
      plain.map((a) => [a.name, a.mimeType, a.locations]),
    );
    expect(encrypted[0]!.text()).toBe(XML);
    expect(encrypted[1]!.bytes()).toEqual(BINARY);
  });

  it("needs the password", async () => {
    await expect(open("pdfkit-attachments-aes256")).rejects.toBeInstanceOf(PdfEncryptedError);
  });
});

describe("hand-built - nested name tree, every standard filter, odd names", () => {
  it("finds every file: the whole tree, an inline file spec, and one only /AF lists", async () => {
    const all = readAttachments(await open("handmade-attachments"));
    expect(all.map((a) => a.name)).toEqual([
      "a85.txt",
      "bad-checksum.txt",
      "hex.txt",
      "lzw.txt",
      "doc—enc.txt", // PDFDocEncoding: byte 0x84 is an em dash
      "runlength.txt",
      "inline.txt",
      "nur-in-AF-ü.txt", // UTF-8 with its BOM
    ]);
    // lzw.txt is in the tree AND in /AF: one attachment, not two.
    expect(all.filter((a) => a.name === "lzw.txt")).toHaveLength(1);
  });

  it("decodes ASCIIHex, ASCII85, LZW, RunLength and a filter chain to the exact file", async () => {
    const all = readAttachments(await open("handmade-attachments"));
    for (const name of [
      "hex.txt",
      "a85.txt",
      "lzw.txt",
      "runlength.txt",
      "doc—enc.txt",
      "inline.txt",
    ]) {
      expect(all.find((a) => a.name === name)!.text(), name).toBe(TEXT);
    }
  });

  it("refuses data that does not match its own checksum, by name", async () => {
    const bad = readAttachments(await open("handmade-attachments")).find(
      (a) => a.name === "bad-checksum.txt",
    )!;
    expect(() => bad.bytes()).toThrow(AttachmentError);
    expect(() => bad.bytes()).toThrow(/does not match its own checksum/);
  });

  it("reads a date with its time zone", async () => {
    const hex = readAttachments(await open("handmade-attachments")).find(
      (a) => a.name === "hex.txt",
    )!;
    expect(hex.modified).toEqual(new Date(Date.UTC(2026, 9, 17, 8, 30, 0))); // 10:30 at +02:00
  });
});

describe("our own writer - what jasy embeds comes back exactly", () => {
  const attachments = [
    {
      name: "factur-x.xml",
      data: new TextEncoder().encode(XML),
      relationship: "Data",
      mimeType: "text/xml",
    },
    { name: "Anhang – ü.bin", data: BINARY, description: "Bytes" },
  ];
  const doc = () => Document([Page([Text("x")])]);

  // A name tree is sorted by key, so "Anhang..." comes before "factur-x.xml".
  const byName = (all: ReturnType<typeof readAttachments>, name: string) =>
    all.find((a) => a.name === name)!;

  it("round-trips name, relationship, type and bytes - keys sorted as a name tree must be", async () => {
    const read = readAttachments(
      await PdfDocument.open(await renderToBytes(doc(), { attachments })),
    );
    expect(read.map((a) => [a.name, a.relationship, a.mimeType])).toEqual([
      ["Anhang – ü.bin", "Unspecified", "application/octet-stream"],
      ["factur-x.xml", "Data", "text/xml"],
    ]);
    expect(byName(read, "factur-x.xml").text()).toBe(XML);
    expect(byName(read, "Anhang – ü.bin").bytes()).toEqual(BINARY);
  });

  it("round-trips through our own AES-256 (R6) encryption - names and files enciphered", async () => {
    const bytes = await renderToBytes(doc(), {
      attachments,
      encrypt: { userPassword: "geheim" },
    } as never);
    // Nothing of the attachment is left readable in the file.
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).not.toContain("factur-x");
    expect(raw).not.toContain("INV-1");
    const read = readAttachments(await PdfDocument.open(bytes, { password: "geheim" }));
    expect(byName(read, "factur-x.xml").text()).toBe(XML);
    expect(byName(read, "Anhang – ü.bin").bytes()).toEqual(BINARY);
  });
});

describe("crypt filters - each part of an encrypted file follows its own", () => {
  // A minimal PDF built by hand, enciphered with our own AES-256 (R6) handler, with the crypt filters
  // rewritten: what Acrobat writes for "encrypt only file attachments", and the opposite.
  const build = async (
    filters: string,
    cipher: { strings: boolean; file: boolean },
    name = "invoice.xml",
  ) => {
    const handler = await createSecurityHandler({ userPassword: "geheim" });
    const hex = (b: Uint8Array) => `<${Buffer.from(b).toString("hex")}>`;
    const str = async (s: string) =>
      cipher.strings ? hex(await handler.encrypt(new TextEncoder().encode(s))) : `(${s})`;
    const data = new TextEncoder().encode(XML);
    const file = cipher.file ? await handler.encrypt(data) : data;
    const objects: Uint8Array[] = [
      new TextEncoder().encode(
        `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [${await str(name)} 4 0 R] >> >> >>`,
      ),
      new TextEncoder().encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      new TextEncoder().encode("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"),
      new TextEncoder().encode(`<< /Type /Filespec /F ${await str(name)} /EF << /F 5 0 R >> >>`),
      Buffer.concat([
        Buffer.from(`<< /Type /EmbeddedFile /Length ${file.length} >>\nstream\n`, "latin1"),
        Buffer.from(file),
        Buffer.from("\nendstream", "latin1"),
      ]),
      new TextEncoder().encode(
        `<< ${handler.encryptDict().replace("/StmF /StdCF /StrF /StdCF", filters)} >>`,
      ),
    ];
    const parts: Buffer[] = [Buffer.from("%PDF-2.0\n", "latin1")];
    const offsets: number[] = [];
    let at = parts[0]!.length;
    objects.forEach((body, i) => {
      offsets.push(at);
      const chunk = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
        Buffer.from(body),
        Buffer.from("\nendobj\n", "latin1"),
      ]);
      parts.push(chunk);
      at += chunk.length;
    });
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    const id = "<00112233445566778899aabbccddeeff>";
    parts.push(
      Buffer.from(
        `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${id} ${id}] >>\nstartxref\n${at}\n%%EOF\n`,
        "latin1",
      ),
    );
    return new Uint8Array(Buffer.concat(parts));
  };

  it("only the attached files encrypted: the document opens, a file asks for the password", async () => {
    const bytes = await build("/StmF /Identity /StrF /Identity /EFF /StdCF", {
      strings: false,
      file: true,
    });
    const locked = readAttachments(await PdfDocument.open(bytes));
    expect(locked.map((a) => a.name)).toEqual(["invoice.xml"]);
    expect(() => locked[0]!.bytes()).toThrow(
      /encrypted on its own; open the PDF with its password/,
    );
    const open = readAttachments(await PdfDocument.open(bytes, { password: "geheim" }));
    expect(open[0]!.text()).toBe(XML);
  });

  it("strings left in the clear (/StrF /Identity) are read as they are, even ones shaped like ciphertext", async () => {
    const name = "an-attachment-name-of-32-bytes.x"; // two AES blocks long, yet plain text
    expect(name.length).toBe(32);
    const bytes = await build(
      "/StmF /Identity /StrF /Identity /EFF /StdCF",
      { strings: false, file: true },
      name,
    );
    const read = readAttachments(await PdfDocument.open(bytes, { password: "geheim" }));
    expect(read[0]!.name).toBe(name);
  });

  it("an attached file left in the clear (/EFF /Identity) is read as it is, not deciphered", async () => {
    const bytes = await build("/StmF /StdCF /StrF /StdCF /EFF /Identity", {
      strings: true,
      file: false,
    });
    const read = readAttachments(await PdfDocument.open(bytes, { password: "geheim" }));
    expect(read[0]!.name).toBe("invoice.xml");
    expect(read[0]!.text()).toBe(XML);
  });

  it("refuses to write back into a file whose parts are enciphered differently", async () => {
    const bytes = await build("/StmF /StdCF /StrF /StdCF /EFF /Identity", {
      strings: true,
      file: false,
    });
    expect((await PdfDocument.open(bytes, { password: "geheim" })).canReEncrypt).toBe(false);
  });
});
