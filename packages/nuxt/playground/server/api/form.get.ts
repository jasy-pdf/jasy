// Zero imports again: the form factories are auto-imported in server/ exactly like Document and Text, so
// a fillable PDF is built the same way as any other. Open /api/form.
export default definePdfHandler(() =>
  Document({ size: 11 }, [
    Page({ size: "A4", margin: 48 }, [
      Column({ gap: 6 }, [
        Text("Membership form", { size: 24, bold: true, color: "#0a2348" }),
        Text("Built server-side. Every field below is a real AcroForm widget - type into it.", {
          size: 11,
          color: "#475569",
        }),

        Text("Full name", { size: 9, color: "#64748b" }),
        TextField({ name: "full_name", value: "Ada Lovelace", height: 24, border: "#94a3b8" }),

        Text("Notes (multiline)", { size: 9, color: "#64748b" }),
        TextField({ name: "notes", multiline: true, height: 52, border: "#94a3b8" }),

        // The label is a plain option here - the slot form only exists in a template.
        Checkbox({ name: "agree", checked: true, size: 14, label: "I agree to the terms" }),

        Text("Plan", { size: 9, color: "#64748b" }),
        RadioGroup({ name: "plan", value: "pro", size: 14 }, [
          { value: "basic", label: "Basic" },
          { value: "pro", label: "Pro" },
        ]),

        Text("Currency - stored value and shown label differ", { size: 9, color: "#64748b" }),
        Dropdown({ name: "currency", value: "EUR", width: 200, height: 21, border: "#94a3b8" }, [
          { value: "EUR", label: "Euro" },
          { value: "CHF", label: "Swiss franc" },
        ]),

        Text("Size", { size: 9, color: "#64748b" }),
        ListBox({ name: "size", value: "M", width: 200, height: 56, border: "#94a3b8" }, [
          "S",
          "M",
          "L",
        ]),

        Row({ gap: 12 }, [
          PushButton({ name: "submit", label: "Submit", width: 120, height: 26 }),
          PushButton({ name: "reset", label: "Reset", action: "reset", width: 120, height: 26 }),
        ]),

        Text("Signature", { size: 9, color: "#64748b" }),
        SignatureField({ name: "sig", label: "Sign here", width: 240, height: 46 }),
      ]),
    ]),
  ]),
);
