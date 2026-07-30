// A file with an OWNER password only: its user password is empty, so every viewer opens it without
// prompting. jasy used to refuse it outright by demanding a password that does not exist.
import { writeFileSync } from "node:fs";
import PDFDocument from "pdfkit";
const doc = new PDFDocument({
  pdfVersion: "1.7ext3",
  ownerPassword: "owner-only",
  permissions: { printing: "highResolution", modifying: false },
});
const chunks = [];
doc.on("data", (c) => chunks.push(c));
const done = new Promise((r) => doc.on("end", r));
doc.initForm();
doc.fontSize(16).text("PDFKit owner-password only", 56, 56);
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
writeFileSync(process.argv[2] + "/pdfkit-owner-only.pdf", bytes);
const raw = bytes.toString("latin1");
console.log(
  "  V:",
  /\/V\s+(\d+)/.exec(raw)?.[1],
  "R:",
  /\/R\s+(\d+)/.exec(raw)?.[1],
  "| Klartext 'Ada':",
  raw.includes("Ada Lovelace"),
);
