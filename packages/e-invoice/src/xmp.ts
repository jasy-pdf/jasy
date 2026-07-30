// Builds the XMP metadata packet for a ZUGFeRD / Factur-X PDF/A-3: the PDF/A-3B identification,
// the Factur-X document properties, AND the mandatory PDF/A extension-schema declaration that
// makes the custom `fx:` namespace valid for validators (veraPDF rejects it otherwise).
// Kept ASCII (entity-escaped) for the renderer's 1-byte pipeline.

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[^\x20-\x7e]/g, (c) => `&#${c.codePointAt(0)};`); // non-ASCII -> numeric entity

export interface XmpOptions {
  title?: string;
  author?: string;
  /** Factur-X conformance level (BG-24 profile), default "EN 16931". */
  conformanceLevel?: string;
}

// One property entry of the extension schema (name + value type + description).
const prop = (name: string, desc: string) =>
  `<rdf:li rdf:parseType="Resource">` +
  `<pdfaProperty:name>${name}</pdfaProperty:name>` +
  `<pdfaProperty:valueType>Text</pdfaProperty:valueType>` +
  `<pdfaProperty:category>external</pdfaProperty:category>` +
  `<pdfaProperty:description>${desc}</pdfaProperty:description>` +
  `</rdf:li>`;

export function facturxXmp(opts: XmpOptions = {}): string {
  const title = esc(opts.title ?? "");
  const author = esc(opts.author ?? "");
  const level = esc(opts.conformanceLevel ?? "EN 16931");

  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    // PDF/A-3B identification
    `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">` +
    `<pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>` +
    `</rdf:Description>` +
    // Dublin Core (title / creator)
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>` +
    `<dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>` +
    `</rdf:Description>` +
    // Factur-X document properties
    `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">` +
    `<fx:DocumentType>INVOICE</fx:DocumentType>` +
    `<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>` +
    `<fx:Version>1.0</fx:Version>` +
    `<fx:ConformanceLevel>${level}</fx:ConformanceLevel>` +
    `</rdf:Description>` +
    // PDF/A extension-schema declaration for the fx: namespace (required by PDF/A)
    `<rdf:Description rdf:about="" ` +
    `xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" ` +
    `xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" ` +
    `xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">` +
    `<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">` +
    `<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>` +
    `<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>` +
    `<pdfaSchema:prefix>fx</pdfaSchema:prefix>` +
    `<pdfaSchema:property><rdf:Seq>` +
    prop("DocumentFileName", "Name of the embedded XML invoice file") +
    prop("DocumentType", "INVOICE") +
    prop("Version", "The actual version of the Factur-X data") +
    prop("ConformanceLevel", "The conformance level of the Factur-X data") +
    `</rdf:Seq></pdfaSchema:property>` +
    `</rdf:li></rdf:Bag></pdfaExtension:schemas>` +
    `</rdf:Description>` +
    `</rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}
