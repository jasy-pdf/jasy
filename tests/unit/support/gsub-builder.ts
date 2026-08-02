// Builds a GSUB table byte by byte, from the spec rather than from a font file - so the reader is
// tested against the format, and the tests still run in a fresh clone where no font is committed.

export const be16 = (v: number) => [(v >>> 8) & 255, v & 255];
export const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const tag = (t: string) => [...t].map((c) => c.charCodeAt(0));

/** Coverage format 1: an explicit glyph list. */
export const coverage1 = (glyphs: number[]) => [
  ...be16(1),
  ...be16(glyphs.length),
  ...glyphs.flatMap(be16),
];

/** Coverage format 2: ranges, so the range branch of the reader is exercised too. */
export const coverage2 = (ranges: [number, number, number][]) => [
  ...be16(2),
  ...be16(ranges.length),
  ...ranges.flatMap(([s, e, i]) => [...be16(s), ...be16(e), ...be16(i)]),
];

/** SingleSubst format 1: every covered glyph shifts by one delta. */
export const single1 = (cov: number[], delta: number) => {
  const head = [...be16(1), ...be16(6), ...be16(delta & 0xffff)];
  return [...head, ...cov];
};

/** SingleSubst format 2: one replacement listed per covered glyph. */
export const single2 = (cov: number[], subs: number[]) => {
  const head = [
    ...be16(2),
    ...be16(6 + subs.length * 2),
    ...be16(subs.length),
    ...subs.flatMap(be16),
  ];
  return [...head, ...cov];
};

/** LigatureSubst: `sets[i]` belongs to the i-th covered glyph; each entry is [result, ...rest]. */
export const ligature = (cov: number[], sets: number[][][]) => {
  const fixed = 6 + sets.length * 2;
  const setBlobs: number[][] = sets.map((set) => {
    const ligs = set.map(([glyph, ...rest]) => [
      ...be16(glyph),
      ...be16(rest.length + 1),
      ...rest.flatMap(be16),
    ]);
    let at = 2 + ligs.length * 2;
    const offsets: number[] = [];
    for (const l of ligs) {
      offsets.push(at);
      at += l.length;
    }
    return [...be16(ligs.length), ...offsets.flatMap(be16), ...ligs.flat()];
  });

  let at = fixed + cov.length;
  const setOffsets: number[] = [];
  for (const b of setBlobs) {
    setOffsets.push(at);
    at += b.length;
  }
  return [
    ...be16(1),
    ...be16(fixed), // coverage sits right after the fixed part
    ...be16(sets.length),
    ...setOffsets.flatMap(be16),
    ...cov,
    ...setBlobs.flat(),
  ];
};

/** A type-7 extension wrapping a real subtable, which is how a large font reaches past 64 KB. */
export const extension = (realType: number, inner: number[]) => [
  ...be16(1),
  ...be16(realType),
  ...be32(8), // the inner subtable starts right after this 8-byte header
  ...inner,
];

export interface LookupSpec {
  type: number;
  subtables: number[][];
}

/** Assemble a whole GSUB table: one script, its features, and the lookups they point at. */
export function buildGsub(
  features: { tag: string; lookups: number[] }[],
  lookups: LookupSpec[],
): Uint8Array {
  // --- LookupList
  const lookupBlobs = lookups.map((l) => {
    const fixed = 6 + l.subtables.length * 2;
    let at = fixed;
    const offsets: number[] = [];
    for (const s of l.subtables) {
      offsets.push(at);
      at += s.length;
    }
    return [
      ...be16(l.type),
      ...be16(0),
      ...be16(l.subtables.length),
      ...offsets.flatMap(be16),
      ...l.subtables.flat(),
    ];
  });
  let at = 2 + lookupBlobs.length * 2;
  const lookupOffsets: number[] = [];
  for (const b of lookupBlobs) {
    lookupOffsets.push(at);
    at += b.length;
  }
  const lookupList = [
    ...be16(lookupBlobs.length),
    ...lookupOffsets.flatMap(be16),
    ...lookupBlobs.flat(),
  ];

  // --- FeatureList
  const featureBlobs = features.map((f) => [
    ...be16(0),
    ...be16(f.lookups.length),
    ...f.lookups.flatMap(be16),
  ]);
  at = 2 + features.length * 6;
  const featureOffsets: number[] = [];
  for (const b of featureBlobs) {
    featureOffsets.push(at);
    at += b.length;
  }
  const featureList = [
    ...be16(features.length),
    ...features.flatMap((f, i) => [...tag(f.tag), ...be16(featureOffsets[i])]),
    ...featureBlobs.flat(),
  ];

  // --- ScriptList: one script, default LangSys listing every feature by index
  const langSys = [
    ...be16(0), // lookupOrder, always null
    ...be16(0xffff), // no required feature
    ...be16(features.length),
    ...features.flatMap((_, i) => be16(i)),
  ];
  const script = [...be16(4), ...be16(0), ...langSys]; // defaultLangSys right after the 4-byte header
  const scriptList = [...be16(1), ...tag("arab"), ...be16(2 + 6), ...script];

  const headerSize = 10;
  return Uint8Array.from([
    ...be32(0x00010000),
    ...be16(headerSize),
    ...be16(headerSize + scriptList.length),
    ...be16(headerSize + scriptList.length + featureList.length),
    ...scriptList,
    ...featureList,
    ...lookupList,
  ]);
}
