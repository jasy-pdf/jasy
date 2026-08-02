/**
 * Arabic (and Syriac / N'Ko / Adlam) JOINING: which of the four positional forms each letter takes -
 * the half of shaping Unicode owns. Runs on the LOGICAL string.
 *
 * Name the SIDES, not the neighbours: a letter is joined on its right when the preceding one can join
 * forwards (type D or L), on its left when the following one can join backwards (D or R). Thinking in
 * "previous/next" puts a final form where an initial belongs.
 */

/**
 * Joining types, from Unicode 17.0.0 `ArabicShaping.txt`, packed as `start,length,type` in hex.
 * Anything not listed is `U` (non-joining), which is the standard's own default.
 *
 * `T` (transparent - combining marks) is mostly NOT in that file: the standard says an unlisted mark
 * (category Mn/Me/Cf) is transparent, so those ranges are folded in from the character database.
 */
const PACKED =
  "300,6f,5 483,6,5 591,2c,5 5bf,0,5 5c1,1,5 5c4,1,5 5c7,0,5 610,a,5 61c,0,5 620,0,1 622,3,2" +
  "  626,0,1 627,0,2 628,0,1 629,0,2 62a,4,1 62f,3,2 633,c,1 640,0,4 641,6,1 648,0,2 649,1,1 64b,14,5" +
  "  66e,1,1 670,0,5 671,2,2 675,2,2 678,f,1 688,11,2 69a,25,1 6c0,0,2 6c1,1,1 6c3,8,2 6cc,0,1" +
  "  6cd,0,2 6ce,0,1 6cf,0,2 6d0,1,1 6d2,1,2 6d5,0,2 6d6,6,5 6df,5,5 6e7,1,5 6ea,3,5 6ee,1,2 6fa,2,1" +
  "  6ff,0,1 70f,0,5 710,0,2 711,0,5 712,2,1 715,4,2 71a,3,1 71e,0,2 71f,8,1 728,0,2 729,0,1 72a,0,2" +
  "  72b,0,1 72c,0,2 72d,1,1 72f,0,2 730,1a,5 74d,0,2 74e,a,1 759,2,2 75c,e,1 76b,1,2 76d,3,1 771,0,2" +
  "  772,0,1 773,1,2 775,2,1 778,1,2 77a,5,1 7a6,a,5 7ca,20,1 7eb,8,5 7fa,0,4 7fd,0,5 816,3,5 81b,8,5" +
  "  825,2,5 829,4,5 840,0,2 841,4,1 846,1,2 848,0,1 849,0,2 84a,9,1 854,0,2 855,0,1 856,2,2 859,2,5" +
  "  860,0,1 862,3,1 867,0,2 868,0,1 869,1,2 870,12,2 883,2,4 886,0,1 889,4,1 88e,0,2 88f,0,1 897,8,5" +
  "  8a0,9,1 8aa,2,2 8ae,0,2 8af,1,1 8b1,1,2 8b3,5,1 8b9,0,2 8ba,e,1 8ca,17,5 8e3,1c,5 1807,0,1" +
  "  180a,0,4 1820,58,1 1885,1,5 1887,21,1 18aa,0,1 200d,0,4 a840,31,1 a872,0,3 fe00,f,5 fe20,f,5" +
  "  10ac0,4,1 10ac5,0,2 10ac7,0,2 10ac9,1,2 10acd,0,3 10ace,4,2 10ad3,3,1 10ad7,0,3 10ad8,4,1" +
  "  10add,0,2 10ade,2,1 10ae1,0,2 10ae4,0,2 10aeb,3,1 10aef,0,2 10b80,0,1 10b81,0,2 10b82,0,1" +
  "  10b83,2,2 10b86,2,1 10b89,0,2 10b8a,1,1 10b8c,0,2 10b8d,0,1 10b8e,1,2 10b90,0,1 10b91,0,2" +
  "  10ba9,3,2 10bad,1,1 10d00,0,3 10d01,20,1 10d22,0,2 10d23,0,1 10ec2,0,2 10ec3,1,1 10ec6,1,1" +
  "  10f30,2,1 10f33,0,2 10f34,10,1 10f51,2,1 10f54,0,2 10f70,3,1 10f74,1,2 10f76,b,1 10fb0,0,1" +
  "  10fb2,1,1 10fb4,2,2 10fb8,0,1 10fb9,1,2 10fbb,1,1 10fbd,0,2 10fbe,1,1 10fc1,0,1 10fc2,1,2" +
  "  10fc4,0,1 10fc9,0,2 10fca,0,1 10fcb,0,3 1e900,43,1 1e94b,0,5";

export type JoiningType = "D" | "R" | "L" | "C" | "T" | "U";
/** The four positional forms, named as the OpenType features that realise them. */
export type JoiningForm = "isol" | "init" | "medi" | "fina";

const TYPES: JoiningType[] = ["U", "D", "R", "L", "C", "T"];

// [start, end, typeIndex] triples, sorted by start - binary searched, so the table costs one lookup.
const RANGES: [number, number, number][] = PACKED.trim()
  .split(/\s+/)
  .map((entry): [number, number, number] => {
    const [start, length, type] = entry.split(",");
    const from = parseInt(start, 16);
    return [from, from + parseInt(length, 16), Number(type)];
  });

/** The joining type of one code point. `U` for everything the table does not mention. */
export function joiningType(codePoint: number): JoiningType {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [from, to, type] = RANGES[mid];
    if (codePoint < from) hi = mid - 1;
    else if (codePoint > to) lo = mid + 1;
    else return TYPES[type];
  }
  return "U";
}

/** Whether a run contains anything the joining pass would touch. Cheap, and false for Latin. */
export function needsJoining(codePoints: readonly number[]): boolean {
  return codePoints.some((cp) => {
    const t = joiningType(cp);
    return t === "D" || t === "R" || t === "L" || t === "C";
  });
}

/**
 * The positional form of every code point, or `null` where none applies (space, digit, mark).
 * `C` (tatweel, ZWJ) counts when deciding a NEIGHBOUR's form but takes none itself.
 */
export function joiningForms(codePoints: readonly number[]): (JoiningForm | null)[] {
  const types = codePoints.map(joiningType);

  /** The nearest neighbour that is not transparent - a mark never breaks a join. */
  const neighbour = (from: number, step: number): JoiningType => {
    for (let i = from + step; i >= 0 && i < types.length; i += step) {
      if (types[i] !== "T") return types[i];
    }
    return "U";
  };

  return types.map((type, i) => {
    if (type !== "D" && type !== "R" && type !== "L") return null;
    const before = neighbour(i, -1);
    const after = neighbour(i, +1);
    const joinedRight = before === "D" || before === "L" || before === "C";
    const joinedLeft = after === "D" || after === "R" || after === "C";

    if (type === "D") {
      if (joinedRight && joinedLeft) return "medi";
      if (joinedRight) return "fina";
      if (joinedLeft) return "init";
      return "isol";
    }
    // R joins only on its right; L (a handful of Syriac letters) only on its left.
    if (type === "R") return joinedRight ? "fina" : "isol";
    return joinedLeft ? "init" : "isol";
  });
}
