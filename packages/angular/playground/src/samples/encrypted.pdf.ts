import type { PdfDocumentFn } from "@jasy/angular";
import { Box, Document, Page, Text } from "@jasy/pdf";

// The password is a render option, not part of the document:
// inject(JasyPdf).download(encryptedPdf, undefined, "secret.pdf", { encrypt: { userPassword } })
export const encryptedPdf: PdfDocumentFn = () =>
  Document([
    Page({ size: "A4", gap: 16 }, [
      Text("Confidential", { size: 28, bold: true, color: "#0a2348" }),
      Text(
        "This document is encrypted with AES-256. A PDF viewer asks for the password before it " +
          "shows anything - and it was rendered right here in your browser.",
        { size: 13, color: "#475569" },
      ),
      Box({ bg: "#fef3c7", padding: 16, radius: 6 }, [
        Text("Salary review, Q3 projections, and other things you would not send in plain text.", {
          size: 12,
          color: "#92400e",
        }),
      ]),
    ]),
  ]);
