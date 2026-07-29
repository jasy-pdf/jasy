# Encrypted-PDF fixtures

Password for every file: **`geheim`** (owner password `geheim-owner`).

All of these were produced by **PDFKit** and **react-pdf**, never by us. That is the whole point: the
first version of the encryption work was verified only against our own output, which proved nothing at
all - we were checking that we could undo our own transformation.

| File                      | Producer      | `/V` `/R` | Cipher            | What it is there to catch                              |
| ------------------------- | ------------- | --------- | ----------------- | ------------------------------------------------------ |
| `pdfkit-rc4-40.pdf`       | PDFKit 0.19   | 1 / 2     | RC4, 40 bit       | **PDFKit's DEFAULT.** The weakest scheme still emitted |
| `pdfkit-rc4-128.pdf`      | PDFKit 0.19   | 2 / 3     | RC4, 128 bit      | the 50-round MD5 key derivation of R3                  |
| `pdfkit-aes-128.pdf`      | PDFKit 0.19   | 4 / 4     | AES-128 (`AESV2`) | crypt filters, and the `sAlT` in the per-object key    |
| `pdfkit-aes-256-r5.pdf`   | PDFKit 0.19   | 5 / 5     | AES-256 (`AESV3`) | Adobe's withdrawn R5: SHA-256 once, no algorithm 2.B   |
| `reactpdf-aes-256-r5.pdf` | react-pdf 4.5 | 5 / 5     | AES-256 (`AESV3`) | the same, from our closest competitor                  |

## What the corpus proved (measured, not assumed)

- **Nobody in the JS ecosystem writes R6.** PDFKit maps `pdfVersion: "1.7ext3"` to R5 and everything
  else to RC4; `"2.0"` falls through to the default and yields **40-bit RC4**. react-pdf inherits this.
  Ghostscript 10.06 refuses outright: _"Encryption revisions 2 and 3 are only supported."_
- Therefore **"we support only R6" meant "we can open nothing but our own files"** - which is exactly
  what a corpus of foreign files is for. Before this, every encryption test passed and the capability
  was zero.
- **RC4 is not a historical curiosity.** It is what the two most popular JS PDF libraries produce when
  you ask them for a password today, with no warning that the key is 40 bits.

## Reading is permissive, writing is not

We READ R2, R3, R4, R5 and R6. We WRITE only R6 (AES-256, ISO 32000-2). `StandardLegacy.encrypt` throws
rather than downgrade: opening files that already exist is a service, handing someone broken protection
is not.

## Regenerating

`gen-all.mjs` (PDFKit, all four revisions) and `gen.mjs` (react-pdf) are kept beside the files. They need
`pdfkit`, `@react-pdf/renderer` and `react` installed in a scratch project - deliberately NOT dependencies
of this repo.
