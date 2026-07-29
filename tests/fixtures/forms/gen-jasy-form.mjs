// Regenerates `jasy-form.pdf`, our own baseline in the form corpus: one field of every kind we can
// create. Kept beside the fixture so it never becomes an unreproducible artifact again.
//
//   pnpm build && node tests/fixtures/forms/gen-jasy-form.mjs
import { writeFileSync } from "node:fs";
import {
  Document,
  Page,
  Column,
  Text,
  TextField,
  Checkbox,
  RadioGroup,
  Dropdown,
  ListBox,
  PushButton,
  SignatureField,
  renderToBytes,
} from "../../../dist/index.js";

const label = (t) => Text(t, { size: 8, color: "#666" });

const doc = Document({ size: 11 }, [
  Page({ margin: 56 }, [
    Column({ gap: 6 }, [
      Text("jasy form", { size: 16 }),
      label("Full name"),
      TextField({ name: "full_name", value: "Ada Lovelace", height: 24, border: "#888" }),
      label("Notes (multiline)"),
      TextField({ name: "notes", multiline: true, height: 56, border: "#888" }),
      Checkbox({ name: "agree", label: "I agree to the terms", checked: true, size: 14 }),
      label("Plan"),
      RadioGroup({ name: "plan", value: "pro", size: 14 }, [
        { value: "basic", label: "Basic" },
        { value: "pro", label: "Pro" },
      ]),
      label("Country (dropdown)"),
      Dropdown({ name: "country", value: "France", width: 200, height: 21, border: "#888" }, [
        "Germany",
        "France",
        "Spain",
      ]),
      label("Size (list box)"),
      ListBox({ name: "size", value: "M", width: 200, height: 60, border: "#888" }, [
        "S",
        "M",
        "L",
      ]),
      PushButton({ name: "go", label: "Submit", width: 120, height: 26 }),
      label("Signature"),
      SignatureField({ name: "sig", label: "Sign here", width: 240, height: 48 }),
    ]),
  ]),
]);

const out = "tests/fixtures/forms/jasy-form.pdf";
writeFileSync(out, await renderToBytes(doc));
console.log("written:", out);
