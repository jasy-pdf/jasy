// Reproducible XSD check: generate a sample invoice's CII and validate it against the vendored
// Factur-X EN16931 schema with xmllint. Used in dev/CI to prove `toCII` stays XSD-conformant.
// Run: pnpm --filter @jasy-pdf/zugferd run validate   (builds first; needs `xmllint` on PATH).
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { toCII } = require("../dist/cii.js");
const { computeInvoice } = require("../dist/compute.js");

const invoice = {
  number: "RE-2026-001",
  issueDate: "2026-06-17",
  currency: "EUR",
  dueDate: "2026-07-01",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Webdesign",
      quantity: 2,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
    {
      name: "Hosting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 50,
      vat: { category: "S", ratePercent: 7 },
    },
  ],
  payment: { iban: "DE02120300000000202051", bic: "BYLADEM1001" },
};

const xml = toCII(invoice, computeInvoice(invoice));
const xmlPath = path.join(os.tmpdir(), "zugferd-validate.xml");
fs.writeFileSync(xmlPath, xml);
const xsd = path.join(__dirname, "..", "schema", "cii", "Factur-X_1.08_EN16931.xsd");

try {
  execFileSync("xmllint", ["--noout", "--schema", xsd, xmlPath], { stdio: "inherit" });
  console.log("✓ CII output is XSD-valid (Factur-X 1.08 EN16931).");
} catch {
  console.error("✗ XSD validation failed (see xmllint output above).");
  process.exit(1);
}
