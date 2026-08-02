import { u16, u32, i16, latin1FromBytes } from "./bytes.ts";

/**
 * The OpenType `GSUB` table: glyph substitution - what makes Arabic letters join and `f`+`i` a `fi`.
 *
 * Narrow on purpose. Of the eight lookup types this reads type 1 (one glyph becomes another - the
 * joining itself), type 4 (several collapse into one - lam-alef) and type 7 (the extension wrapper).
 * Anything else is reported, not guessed at, so a font needing more fails visibly.
 *
 * Structure: a SCRIPT picks a language system, which lists FEATURES, which list LOOKUPS.
 */

/** A lookup we know how to run: its type and the absolute offsets of its subtables. */
interface Lookup {
  type: number;
  subtables: number[];
}

const EXTENSION = 7;

/** A coverage table may not expand past this: a glyph id is a uint16, so no honest one can. */
const MAX_COVERAGE_ENTRIES = 65536;

export class GsubTable {
  private scriptList: number;
  private featureList: number;
  private lookupList: number;
  private lookupCache = new Map<number, Lookup | null>();
  private coverageCache = new Map<number, Map<number, number>>();

  constructor(
    private data: Uint8Array,
    private base: number,
  ) {
    this.scriptList = base + u16(data, base + 4);
    this.featureList = base + u16(data, base + 6);
    this.lookupList = base + u16(data, base + 8);
  }

  /** Whether the font carries this script at all - `arab` is the question the shaper asks. */
  hasScript(script: string): boolean {
    return this.scriptOffset(script) !== undefined;
  }

  /** A feature's lookup indices, under the script's DEFAULT language system - Arabic shaping features
   *  are script-wide, so a language-specific override would only add typographic niceties. */
  lookups(script: string, feature: string): number[] {
    const scriptOff = this.scriptOffset(script);
    if (scriptOff === undefined) return [];
    // The default LangSys is optional; fall back to the first named one - a font declaring only
    // `ARA ` still shapes Arabic.
    const defaultOff = u16(this.data, scriptOff);
    const langSys =
      defaultOff !== 0
        ? scriptOff + defaultOff
        : u16(this.data, scriptOff + 2) > 0
          ? // The first LangSysRecord is at +4 and is tag(4) + offset(2), so its offset is at +8.
            scriptOff + u16(this.data, scriptOff + 8)
          : undefined;
    if (langSys === undefined) return [];

    const out: number[] = [];
    const count = u16(this.data, langSys + 4);
    for (let i = 0; i < count; i++) {
      const featureIndex = u16(this.data, langSys + 6 + i * 2);
      const record = this.featureList + 2 + featureIndex * 6;
      if (latin1FromBytes(this.data.subarray(record, record + 4)) !== feature) continue;
      const featureOff = this.featureList + u16(this.data, record + 4);
      const lookupCount = u16(this.data, featureOff + 2);
      for (let j = 0; j < lookupCount; j++) out.push(u16(this.data, featureOff + 4 + j * 2));
    }
    return out;
  }

  /** Type 1: substitute one glyph. `null` when no subtable covers it - the feature does not apply. */
  substituteSingle(lookupIndex: number, glyph: number): number | null {
    const lookup = this.lookup(lookupIndex);
    if (!lookup || lookup.type !== 1) return null;
    for (const sub of lookup.subtables) {
      const coverage = this.coverage(sub + u16(this.data, sub + 2));
      const index = coverage.get(glyph);
      if (index === undefined) continue;
      // Format 1 shifts every covered glyph by one delta; format 2 lists a replacement per glyph.
      return u16(this.data, sub) === 1
        ? (glyph + i16(this.data, sub + 4)) & 0xffff
        : u16(this.data, sub + 6 + index * 2);
    }
    return null;
  }

  /**
   * Type 4: collapse a run of glyphs into one, starting at `at`. Longest match wins, as the spec
   * requires - a three-glyph ligature beats the two-glyph one that starts the same way.
   */
  substituteLigature(
    lookupIndex: number,
    glyphs: readonly number[],
    at: number,
  ): { glyph: number; consumed: number } | null {
    const lookup = this.lookup(lookupIndex);
    if (!lookup || lookup.type !== 4) return null;
    let best: { glyph: number; consumed: number } | null = null;

    for (const sub of lookup.subtables) {
      const coverage = this.coverage(sub + u16(this.data, sub + 2));
      const setIndex = coverage.get(glyphs[at]);
      if (setIndex === undefined) continue;
      const set = sub + u16(this.data, sub + 6 + setIndex * 2);
      const ligatureCount = u16(this.data, set);
      for (let i = 0; i < ligatureCount; i++) {
        const lig = set + u16(this.data, set + 2 + i * 2);
        const components = u16(this.data, lig + 2); // includes the glyph coverage already matched
        if (at + components > glyphs.length) continue;
        let matches = true;
        for (let c = 1; c < components && matches; c++) {
          matches = glyphs[at + c] === u16(this.data, lig + 2 + c * 2);
        }
        if (matches && (best === null || components > best.consumed)) {
          best = { glyph: u16(this.data, lig), consumed: components };
        }
      }
    }
    return best;
  }

  /** The type of a lookup, for reporting what a font needs that we do not do. */
  lookupType(lookupIndex: number): number | undefined {
    return this.lookup(lookupIndex)?.type;
  }

  private scriptOffset(script: string): number | undefined {
    const count = u16(this.data, this.scriptList);
    for (let i = 0; i < count; i++) {
      const record = this.scriptList + 2 + i * 6;
      if (latin1FromBytes(this.data.subarray(record, record + 4)) === script) {
        return this.scriptList + u16(this.data, record + 4);
      }
    }
    return undefined;
  }

  /**
   * Resolve a lookup, unwrapping type 7 (extension) - which exists only because the 16-bit offsets
   * elsewhere cannot reach far enough in a big font. Callers never learn it was wrapped.
   */
  private lookup(index: number): Lookup | null {
    const cached = this.lookupCache.get(index);
    if (cached !== undefined) return cached;

    let result: Lookup | null = null;
    if (index < u16(this.data, this.lookupList)) {
      const off = this.lookupList + u16(this.data, this.lookupList + 2 + index * 2);
      const type = u16(this.data, off);
      const count = u16(this.data, off + 4);
      const subtables: number[] = [];
      let realType = type;
      for (let i = 0; i < count; i++) {
        const sub = off + u16(this.data, off + 6 + i * 2);
        if (type === EXTENSION) {
          realType = u16(this.data, sub + 2);
          subtables.push(sub + u32(this.data, sub + 4));
        } else {
          subtables.push(sub);
        }
      }
      result = { type: realType, subtables };
    }
    this.lookupCache.set(index, result);
    return result;
  }

  /** Coverage table -> glyph id to its INDEX in the table, which is how subtables address glyphs. */
  private coverage(off: number): Map<number, number> {
    const cached = this.coverageCache.get(off);
    if (cached) return cached;

    const map = new Map<number, number>();
    const count = u16(this.data, off + 2);
    if (u16(this.data, off) === 1) {
      for (let i = 0; i < count; i++) map.set(u16(this.data, off + 4 + i * 2), i);
    } else {
      // Format 2 is RANGES, and a malformed file can claim far more glyphs than any font holds. Such
      // a table is refused whole rather than expanded - the feature then simply does not apply.
      let total = 0;
      for (let i = 0; i < count; i++) {
        const record = off + 4 + i * 6;
        const start = u16(this.data, record);
        const end = u16(this.data, record + 2);
        if (end < start) continue; // an inverted range covers nothing
        total += end - start + 1;
        if (total > MAX_COVERAGE_ENTRIES) return this.cacheCoverage(off, new Map());
        const startIndex = u16(this.data, record + 4);
        for (let g = start; g <= end; g++) map.set(g, startIndex + (g - start));
      }
    }
    return this.cacheCoverage(off, map);
  }

  private cacheCoverage(off: number, map: Map<number, number>): Map<number, number> {
    this.coverageCache.set(off, map);
    return map;
  }
}
