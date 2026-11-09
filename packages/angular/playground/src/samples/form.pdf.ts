import type { PdfDocument } from "@jasy/angular";
import {
  Checkbox,
  Document,
  Dropdown,
  ListBox,
  Page,
  PushButton,
  RadioGroup,
  Row,
  SignatureField,
  Spacer,
  Text,
  TextField,
} from "@jasy/pdf";

const label = (text: string) => Text(text, { size: 9, color: "#64748b" });
const border = "#94a3b8";

// Every field is a real AcroForm widget: open the PDF and type into it.
export const formPdf: PdfDocument<{ name: string }> = ({ name }) =>
  Document({ size: 11 }, [
    Page({ size: "A4", margin: 48, gap: 6 }, [
      Text("Membership form", { size: 24, bold: true, color: "#0a2348" }),
      Text("Every field below is a real form field. Click into it and type.", { color: "#475569" }),

      label("Full name"),
      TextField({ name: "full_name", value: name, height: 24, border }),

      label("Notes (multiline)"),
      TextField({ name: "notes", value: "jasy is great!", multiline: true, height: 52, border }),

      Checkbox({
        name: "agree",
        checked: true,
        size: 14,
        label: `I agree to the terms, ${name.split(" ")[0]}`,
      }),

      label("Plan"),
      RadioGroup({ name: "plan", value: "pro", size: 14 }, [
        { value: "basic", label: "basic" },
        { value: "pro", label: "pro" },
      ]),

      label("Size - options as plain strings"),
      ListBox({ name: "size", value: "M", width: 200, height: 56, border }, ["S", "M", "L"]),

      label("Currency - value and label differ"),
      Dropdown({ name: "currency", value: "EUR", width: 200, height: 21, border }, [
        { value: "EUR", label: "Euro" },
        { value: "CHF", label: "Swiss franc" },
        { value: "GBP", label: "Pound sterling" },
      ]),

      Row({ gap: 12 }, [
        PushButton({ name: "submit", label: "Submit", width: 120, height: 26 }),
        PushButton({ name: "reset", label: "Reset", width: 120, height: 26, action: "reset" }),
      ]),

      label("Signature"),
      SignatureField({ name: "sig", label: "Sign here", width: 240, height: 46 }),

      Spacer(),
      Text("Rendered in your browser by @jasy/angular - no Java, no headless browser.", {
        size: 10,
        color: "#94a3b8",
      }),
    ]),
  ]);
