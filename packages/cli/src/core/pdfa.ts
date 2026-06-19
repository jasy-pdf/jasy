// Structural PDF/A-3 + ZUGFeRD/Factur-X conformance checks — pure Node. This is NOT full ISO 19005-3
// validation (that's veraPDF, Java — offered as an optional adapter). It's the structural / metadata
// layer that actually trips e-invoice PDFs in practice: the rules our own writer satisfies, read
// backwards. Great as a regression guard for us and a fast local signal for foreign PDFs.

export interface PdfaCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface PdfaReport {
  /** true when every structural check passed (NOT an ISO certification — see veraPDF for that). */
  ok: boolean;
  checks: PdfaCheck[];
}

export function checkPdfA3(pdf: Uint8Array): PdfaReport {
  const s = Buffer.from(pdf).toString("latin1");
  const xmp = s.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/)?.[0] ?? "";
  const checks: PdfaCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string): void => {
    checks.push({ id, label, ok, detail });
  };

  // header + binary marker (≥4 bytes > 127 on the comment line) — required for PDF/A
  const version = s.match(/^%PDF-(\d\.\d)/)?.[1];
  add("header", "PDF header & version", !!version, version ? `%PDF-${version}` : "missing");
  const afterHeader = s.slice(s.indexOf("\n") + 1, s.indexOf("\n") + 9);
  const binaryMarker =
    afterHeader.startsWith("%") &&
    Array.from(afterHeader.slice(1, 5)).some((c) => c.charCodeAt(0) > 127);
  add("binary-marker", "binary marker comment", binaryMarker);

  // forbidden in PDF/A
  add("no-encrypt", "not encrypted", !/\/Encrypt\b/.test(s));
  add("no-javascript", "no JavaScript actions", !/\/JavaScript\b|\/JS\s/.test(s));
  add("no-lzw", "no LZW compression", !/\/LZWDecode\b/.test(s));

  // trailer /ID (required)
  add("file-id", "document /ID present", /\/ID\s*\[\s*<[0-9A-Fa-f]/.test(s));

  // XMP metadata + PDF/A identification
  add("xmp", "XMP metadata present", xmp.length > 0);
  const part = xmp.match(/pdfaid:part[^0-9]{0,4}(\d)/)?.[1];
  add("pdfa-part", "declares PDF/A part 3", part === "3", part ? `part ${part}` : "missing");
  const conformance = xmp.match(/pdfaid:conformance[^ABU]{0,4}([ABU])/)?.[1];
  add(
    "pdfa-conformance",
    "PDF/A conformance level",
    !!conformance,
    conformance ? `level ${conformance}` : "missing",
  );

  // Factur-X / ZUGFeRD XMP extension schema (the e-invoice fingerprint)
  const fxFile =
    xmp.match(/DocumentFileName[^>]*>\s*([^<\s]+\.xml)/i)?.[1] ??
    (/DocumentFileName/i.test(xmp) ? "?" : undefined);
  add(
    "facturx-xmp",
    "Factur-X/ZUGFeRD XMP extension",
    /ConformanceLevel/i.test(xmp) && /DocumentType/i.test(xmp),
    fxFile,
  );

  // PDF/A OutputIntent with an embedded ICC profile (needed once colour/transparency is used)
  add(
    "output-intent",
    "PDF/A OutputIntent (sRGB ICC)",
    /\/OutputIntent/.test(s) && /\/DestOutputProfile/.test(s) && /\/S\s*\/GTS_PDFA1/.test(s),
  );

  // the embedded XML attached as an Associated File with a relationship (ZUGFeRD requirement)
  add(
    "associated-file",
    "embedded XML as Associated File",
    /\/AF\b/.test(s) &&
      /\/AFRelationship\s*\/(Alternative|Data|Source)/.test(s) &&
      /\/EF\s*<</.test(s),
  );

  // every font must be embedded (no font descriptor without a font program)
  // count the descriptor objects (/Type /FontDescriptor), not the /FontDescriptor ref entries
  const descriptors = (s.match(/\/Type\s*\/FontDescriptor\b/g) ?? []).length;
  const programs = (s.match(/\/FontFile[23]?\b/g) ?? []).length;
  add(
    "fonts-embedded",
    "all fonts embedded",
    descriptors === 0 || programs >= descriptors,
    `${programs}/${descriptors} programs`,
  );

  return { ok: checks.every((c) => c.ok), checks };
}
