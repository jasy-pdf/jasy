# Vendored validation rules

The official **EN 16931 / XRechnung Schematron** business rules, compiled to SaxonJS SEF
(`.sef.json`, gzipped) so the CLI validates invoices **locally** via `saxon-js` — no upload, DSGVO-safe.
This covers the XML conformance (the legally decisive part); full ISO 19005 (PDF/A) is the optional
veraPDF adapter (`jasy verapdf`), with our own structural checks (`core/pdfa.ts`) as the default.

`validate.ts` picks the rule set from what `detect()` found. **XRechnung is a CIUS on top of EN 16931**,
so its files carry only the BR-DE delta — an XRechnung is validated against the EN 16931 base **and**
the XRechnung rules, and the findings are merged.

| File                        | Rules                                             | Upstream                                                                                                                                                   |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en16931-cii.sef.json.gz`   | EN 16931 — UN/CEFACT **CII** (ZUGFeRD / Factur-X) | [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931) (Apache-2.0), `cii/xslt/EN16931-CII-validation.xslt`         |
| `en16931-ubl.sef.json.gz`   | EN 16931 — OASIS **UBL** (PEPPOL)                 | same repo, `ubl/xslt/EN16931-UBL-validation.xslt`                                                                                                          |
| `xrechnung-cii.sef.json.gz` | XRechnung 3.0 BR-DE delta — **CII**               | [itplr-kosit/xrechnung-schematron](https://github.com/itplr-kosit/xrechnung-schematron) v2.5.0 (Apache-2.0), `schematron/cii/XRechnung-CII-validation.xsl` |
| `xrechnung-ubl.sef.json.gz` | XRechnung 3.0 BR-DE delta — **UBL**               | same release, `schematron/ubl/XRechnung-UBL-validation.xsl`                                                                                                |

**To refresh / add a profile:** fetch the upstream `.xslt`/`.xsl`, then
`xslt3 -xsl:<file> -export:<out>.sef.json -nogo` and `gzip` the result into this folder.
(`xslt3` is the SaxonJS compiler, a devDependency.)
