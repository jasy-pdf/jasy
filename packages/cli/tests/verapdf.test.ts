import { describe, it, expect } from "vitest";
import { parseVeraReport } from "../src/core/verapdf";

// real veraPDF 1.30 `--format xml` shapes (captured from live runs)
const PASS = `<report><jobs><job><validationReport jobEndStatus="normal" profileName="PDF/A-3b validation profile" statement="PDF file is compliant with Validation Profile requirements." isCompliant="true"><details passedRules="146" failedRules="0" passedChecks="3745" failedChecks="0"></details></validationReport></job></jobs></report>`;
const FAIL = `<validationReport jobEndStatus="normal" profileName="PDF/A-3b validation profile" statement="not compliant" isCompliant="false"><rule specification="ISO 19005-3:2012" clause="6.6.2.1" testNumber="1" status="failed" failedChecks="1"><check status="failed"/></rule><rule specification="ISO 19005-3:2012" clause="6.2.4.3" testNumber="2" status="failed" failedChecks="42"></rule></validationReport>`;

describe("parseVeraReport", () => {
  it("reads a compliant report", () => {
    const r = parseVeraReport(PASS);
    expect(r.ok).toBe(true);
    expect(r.profile).toBe("PDF/A-3b validation profile");
    expect(r.passedRules).toBe(146);
    expect(r.failedRules).toBe(0);
    expect(r.failures).toEqual([]);
  });

  it("reads a non-compliant report with the failed ISO clauses", () => {
    const r = parseVeraReport(FAIL);
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([
      { clause: "6.6.2.1", failedChecks: 1 },
      { clause: "6.2.4.3", failedChecks: 42 },
    ]);
  });
});
