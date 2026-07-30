import { writeFileSync } from "node:fs";
import PDFDocument from "pdfkit";
const PASSWORD = "geheim";
const out = process.argv[2] ?? ".";
// PDFKit maps its `pdfVersion` onto the encryption revision: default -> V1/R2 (RC4 40 bit),
// 1.4/1.5 -> V2/R3 (RC4 128), 1.6/1.7 -> V4 (AES-128), 1.7ext3 -> V5/R5 (AES-256).
const VARIANTS = [
  ["rc4-40", undefined],
  ["rc4-128", "1.4"],
  ["aes-128", "1.6"],
  ["aes-256-r5", "1.7ext3"],
];
for (const [label, version] of VARIANTS) {
  const doc = new PDFDocument({
    ...(version ? { pdfVersion: version } : {}),
    userPassword: PASSWORD,
    ownerPassword: PASSWORD + "-owner",
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));
  doc.initForm();
  doc.fontSize(16).text("PDFKit " + label, 56, 56);
  doc.fontSize(9).fillColor("#666").text("Full name", 56, 96);
  doc.formText("full_name", 56, 108, 400, 22, { value: "Ada Lovelace", borderColor: "#888888" });
  doc.fillColor("#666").text("Notes", 56, 146);
  doc.formText("notes", 56, 158, 400, 44, {
    value: "Umlaute: äöüß",
    multiline: true,
    borderColor: "#888888",
  });
  doc.end();
  await done;
  const bytes = Buffer.concat(chunks);
  writeFileSync(`${out}/pdfkit-${label}.pdf`, bytes);
  const raw = bytes.toString("latin1");
  console.log(
    `  pdfkit-${label}.pdf`.padEnd(30),
    "V:",
    /\/V\s+(\d+)/.exec(raw)?.[1] ?? "-",
    "R:",
    /\/R\s+(\d+)/.exec(raw)?.[1] ?? "-",
    "CFM:",
    /\/CFM\s*\/(\w+)/.exec(raw)?.[1] ?? "-",
  );
}
