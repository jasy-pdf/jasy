// Generates ENCRYPTED AcroForm PDFs from two independent producers, so our decryption is proved against
// files we did not write. Both use AES-256 (V5/R6), which is what jasy implements.
import { writeFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import React from "react";
import {
  renderToBuffer,
  Document,
  Page,
  View,
  Text,
  TextInput,
  Checkbox,
} from "@react-pdf/renderer";

const PASSWORD = "geheim";
const out = process.argv[2] ?? ".";

// ---- 1. PDFKit -----------------------------------------------------------------------------------
async function pdfkitForm() {
  const doc = new PDFDocument({
    pdfVersion: "RC4PLACEHOLDER", // PDFKit's name for the V5 / AES-256 handler
    userPassword: PASSWORD,
    ownerPassword: PASSWORD + "-owner",
    permissions: { printing: "highResolution" },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", r));

  doc.initForm();
  doc.fontSize(16).text("PDFKit encrypted form", 56, 56);
  doc.fontSize(9).fillColor("#666").text("Full name", 56, 96);
  doc.formText("full_name", 56, 108, 400, 22, {
    value: "Ada Lovelace",
    borderColor: "#888888",
  });
  doc.fillColor("#666").text("Notes", 56, 146);
  doc.formText("notes", 56, 158, 400, 44, {
    value: "Zwei Zeilen mit Umlauten:\näöüß und 1.234,56 EUR",
    multiline: true,
    borderColor: "#888888",
  });
  doc.fillColor("#000").text("I agree", 84, 220);
  doc.formCheckbox("agree", 56, 216, 16, 16, { borderColor: "#888888" });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// ---- 2. react-pdf --------------------------------------------------------------------------------
async function reactPdfForm() {
  const e = React.createElement;
  const label = (t) => e(Text, { style: { fontSize: 9, color: "#666", marginTop: 10 } }, t);
  const tree = e(
    Document,
    { pdfVersion: "1.7ext3", userPassword: PASSWORD, ownerPassword: PASSWORD + "-owner" },
    e(
      Page,
      { size: "A4", style: { padding: 56 } },
      e(View, {}, [
        e(
          Text,
          { key: "h", style: { fontSize: 16, marginBottom: 12 } },
          "react-pdf encrypted form",
        ),
        label("Full name"),
        e(TextInput, {
          key: "n",
          name: "full_name",
          value: "Ada Lovelace",
          style: { height: 22, borderWidth: 1, borderColor: "#888" },
        }),
        label("Notes"),
        e(TextInput, {
          key: "no",
          name: "notes",
          value: "Zwei Zeilen mit Umlauten:\näöüß und 1.234,56 EUR",
          multiline: true,
          style: { height: 44, borderWidth: 1, borderColor: "#888" },
        }),
        label("I agree"),
        e(Checkbox, {
          key: "a",
          name: "agree",
          style: { width: 16, height: 16, borderWidth: 1, borderColor: "#888" },
        }),
      ]),
    ),
  );
  return await renderToBuffer(tree);
}

const a = await pdfkitForm();
writeFileSync(`${out}/pdfkit-encrypted.pdf`, a);
console.log("pdfkit-encrypted.pdf   ", a.length, "bytes");

const b = await reactPdfForm();
writeFileSync(`${out}/reactpdf-encrypted.pdf`, b);
console.log("reactpdf-encrypted.pdf ", b.length, "bytes");
