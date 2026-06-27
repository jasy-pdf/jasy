import { describe, it, expect, beforeEach, vi } from "vitest";
import { AFMParser } from "../../../src/lib/utils/afm-parser";
import fs from "fs";

// Mock-Daten für den AFM-Parser
const mockAFMData = `
StartCharMetrics
C 65 ; WX 722 ; N A ; 
C 66 ; WX 667 ; N B ; 
EndCharMetrics
KPX A V -80
KPX A W -70
`;

const mockGlyphList = `
0041;A
0042;B
`;

describe("AFMParser", () => {
  let afmParser: AFMParser;

  beforeEach(() => {
    // Mock für fs.readFileSync mit Vitest
    vi.spyOn(fs, "readFileSync").mockImplementation((path: any, _options?: any): any => {
      if (path.includes("agl.txt")) {
        return mockGlyphList;
      } else if (path.includes("afm")) {
        return mockAFMData;
      }
      return "";
    });

    // Initialisierung des Parsers
    afmParser = new AFMParser(mockAFMData);
  });

  it("should load glyphs correctly", () => {
    expect(afmParser.getAdvanceWidth("A")).toBe(722);
    expect(afmParser.getAdvanceWidth("B")).toBe(667);
  });

  it("should calculate kerning correctly", () => {
    expect(afmParser.getKerning("A", "V")).toBe(-80);
    expect(afmParser.getKerning("A", "W")).toBe(-70);
  });

  it("should return 0 for unknown glyphs", () => {
    expect(afmParser.getAdvanceWidth("Z")).toBe(0);
  });
});
