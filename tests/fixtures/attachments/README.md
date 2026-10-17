# Attachment fixtures

PDFs with embedded files from **independent producers**, so the attachment reader is never tested only
against our own output. Regenerate with `gen.mjs` (see its header); the hand-built file is checked
against poppler (`pdfdetach -list` / `-saveall`), an independent reader, which decodes every one of its
files to the exact expected bytes.

| File                            | Producer     | What it is there to catch                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdflib-attachments.pdf`        | pdf-lib 1.17 | **xref stream + object streams**, `AFRelationship`, a Unicode file name, every byte value                                                                                                                                                                                 |
| `pdfkit-attachments.pdf`        | PDFKit 0.19  | a file **attached to a page** (FileAttachment annotation) that is also listed in `/AF`                                                                                                                                                                                    |
| `pdfkit-attachments-aes256.pdf` | PDFKit 0.19  | the same, **AES-256 (R5)**, password `geheim` - PDFKit leaves the name-tree key in the clear                                                                                                                                                                              |
| `handmade-attachments.pdf`      | `gen.mjs`    | a **nested name tree** (`/Kids`, `/Limits`), an inline file spec, a file only `/AF` lists, every standard filter (ASCIIHex, ASCII85, LZW, RunLength, ASCII85+Flate), a PDFDocEncoding name (0x84 = em dash), a UTF-8 name, a file that does not match its own `/CheckSum` |

## What the corpus proved (measured, not assumed)

- **PDFKit writes a clear-text string into an encrypted file** (the `/EmbeddedFiles` key). A reader that
  insists every string is ciphertext cannot open PDFKit's encrypted attachments at all.
- **PDFKit attaches a page file in two places** - the annotation and the catalog's `/AF` - so one file
  spec has two locations, and merging by object reference (never by name) is what keeps it one file.
- **Poppler does not read `/AF`**: it lists seven of the hand-built file's eight attachments.
