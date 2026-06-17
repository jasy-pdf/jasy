# Vendored schemas

`cii/` holds the **UN/CEFACT Cross Industry Invoice** XSD set for the **Factur-X / ZUGFeRD 1.08,
EN16931 profile** — used to XSD-validate the XML produced by `toCII`.

- `Factur-X_1.08_EN16931.xsd` — entry point; imports the three modules below by filename.
- `…ReusableAggregateBusinessInformationEntity_100.xsd`, `…QualifiedDataType_100.xsd`,
  `…UnqualifiedDataType_100.xsd`

**Origin / licence:** taken from [akretion/factur-x](https://github.com/akretion/factur-x)
(BSD-3-Clause), which redistributes the schemas published by UN/CEFACT and the EN-16931 standard.
Kept verbatim (the exact filenames matter — the entry XSD imports the others by name).

The EN-16931 **Schematron** (business rules) is compiled to XSLT 2.0; running it needs Saxon /
`saxon-js`, so it is **not** vendored here yet — Schematron + KoSIT + veraPDF run in external CI
(and, later, a local validation CLI). See `todo.md` Phase 6.
