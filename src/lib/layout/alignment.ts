/**
 * Flex alignment vocabulary. It lives here rather than in `utils/flex-layout.ts` because the base
 * `PDFElement` needs `CrossAlign` for `alignSelf`, and flex-layout imports the elements - defining it
 * there would close a cycle.
 */

/** Distribution along the MAIN axis (CSS `justify-content`). */
export type MainAlign = "start" | "center" | "end" | "between" | "around";

/** Position/size ACROSS the axis (CSS `align-items` / `align-self`). `stretch` fills the cross extent;
 *  the others place the child at its natural cross size. */
export type CrossAlign = "start" | "center" | "end" | "stretch";
