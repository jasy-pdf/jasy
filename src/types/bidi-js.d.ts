/**
 * Local typings for `bidi-js`, which ships none. Only the surface we use is declared - deliberately,
 * so the seam in `text/bidi.ts` stays the single place that knows this library exists at all.
 */
declare module "bidi-js" {
  export interface EmbeddingLevels {
    /** UAX #9 embedding level per UTF-16 code unit; odd means right-to-left. */
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }

  export interface Bidi {
    getEmbeddingLevels(text: string, baseDirection?: "ltr" | "rtl" | "auto"): EmbeddingLevels;
    /** Logical indices in the order they are DRAWN, left to right (rule L2). */
    getReorderedIndices(text: string, levels: EmbeddingLevels): number[];
    /** Index -> replacement for characters that mirror in a right-to-left run, e.g. `(` -> `)`.
     *  Takes the LEVEL ARRAY, unlike its neighbours - typed that way on purpose so the mistake the
     *  library's own README invites cannot compile. */
    getMirroredCharactersMap(text: string, levels: Uint8Array): Map<number, string>;
  }

  export default function bidiFactory(): Bidi;
}
