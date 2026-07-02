import { Color } from "../common/color.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";

/**
 * Display list - the seam between layout and the PDF backend.
 *
 * Everything above this line (components, layout) produces an `IRNode[]`; the PDF
 * backend below consumes ONLY `IRNode`s and never sees a component. The primitives
 * are intentionally "dumb": absolute geometry + semantic style, with no PDF
 * operators, no font indices, and no object numbers - those are the backend's job.
 *
 * Coordinates are in PDF points (1/72"). Which origin they use is still the
 * producer's concern for now; centralizing the Y-flip at this seam is Phase 3.
 */

/**
 * Structure tag for accessible (PDF/UA) tagging. `role` is the PDF structure type the content maps to
 * (`P`, `H1`..`H6`, `Figure`, `TD`, …); `key` groups the IR nodes of one logical element (e.g. every line
 * of a paragraph) into a single structure element; `alt` is the alternate text for a figure. A drawable
 * node WITHOUT a tag is emitted as an Artifact (decoration, skipped by screen readers).
 */
export interface StructTag {
  role: string; // the PDF structure type for the BDC marked-content (P, H1, Figure, …)
  key: number; // the StructElem this content belongs to (registered via StructTree.openElement)
}

/**
 * A single positioned run of text in one font / size / color. Line wrapping has
 * already happened upstream: the producer emits one `TextRun` per laid-out line or
 * per styled segment within a line.
 */
export interface TextRun {
  type: "text";
  x: number;
  y: number;
  text: string; // raw text; the backend handles PDF string escaping + encoding
  fontFamily: string;
  fontStyle: FontStyle;
  fontSize: number;
  color: Color;
  tag?: StructTag; // accessible tagging; absent = Artifact
}

/** An axis-aligned rectangle. An absent `fill` or `stroke` means that part is not drawn. */
export interface Rect {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: Color;
  stroke?: Color;
  strokeWidth: number;
  /** Corner radius in points; absent/0 = sharp corners (plain `re`). */
  radius?: number;
  tag?: StructTag; // accessible tagging; absent = Artifact
}

/** A straight line segment between two points. */
export interface Line {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Color;
  strokeWidth: number;
  tag?: StructTag; // accessible tagging; absent = Artifact
}

/** A raster image, already resolved to bytes by the producer (no `CustomImage` here). */
export interface Image {
  type: "image";
  x: number; // placement origin
  y: number;
  width: number; // placement size (the drawing scale, after fit)
  height: number;
  intrinsicWidth: number; // source pixel width, for the XObject /Width
  intrinsicHeight: number; // source pixel height, for the XObject /Height
  data: string; // binary string of the encoded image bytes
  imageType: string; // PDF filter name, e.g. "DCTDecode" (JPEG) or "FlateDecode" (PNG)
  /** Flate-compressed DeviceGray alpha channel for a transparent PNG, embedded as the XObject's /SMask. */
  smask?: string;
  /** cover/contain fits clip the placement to the element's original frame. */
  clip?: { x: number; y: number; width: number; height: number };
  /** Corner radius in points for the image box; absent/0 = sharp corners. */
  radius?: number;
  tag?: StructTag; // accessible tagging (a Figure needs `alt`); absent = Artifact
}

/**
 * Pushes a clipping region (a rectangle, rounded when `radius` is set). Everything between this and
 * the matching `ClipPop` is clipped to it - what a Box with `overflow: "hidden"` wraps its children
 * in, so a `Positioned` child gets cropped at the box edge instead of spilling over.
 */
export interface ClipPush {
  type: "clip-push";
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

/** Closes the most recent `ClipPush` (restores the graphics state). */
export interface ClipPop {
  type: "clip-pop";
}

/** The closed set of primitives the PDF backend knows how to draw. */
export type IRNode = TextRun | Rect | Line | Image | ClipPush | ClipPop;
