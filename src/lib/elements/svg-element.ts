import { readFileBytes } from "../platform/node-fs.ts";
import { SvgParseError, svgSize, svgToIr, type SvgSize } from "../svg/index.ts";
import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "./pdf-element.ts";
import { IMAGE_FETCH_LIMITS, ImageUrlError, isImageUrl } from "./image-element.ts";
import { fetchBytes } from "../utils/fetch-bytes.ts";

/** Markup, a URL (`http(s):`, `data:`), a file path (Node only), or the file's bytes. */
export type SvgSource = string | Uint8Array;

interface SvgElementParams extends SizingParams {
  source: SvgSource;
  /** Width/height as a fraction (0..1) of the offered box, for `"50%"`. */
  widthFactor?: number;
  heightFactor?: number;
  /** Alternate text for the tagged structure tree; makes the drawing a Figure rather than decoration. */
  alt?: string;
}

/** Markup is recognised by its first non-space character - anything else is treated as a path. */
const looksLikeMarkup = (value: string): boolean => /^\s*[<﻿]/.test(value);

/**
 * Reads the file, or says what went wrong in the caller's terms. A string that is neither markup nor
 * a readable path would otherwise surface as a bare `ENOENT`, which never mentions that the argument
 * was taken as a PATH in the first place.
 */
function readSource(path: string): Uint8Array {
  try {
    return readFileBytes(path);
  } catch (error) {
    const shown = path.length > 80 ? `${path.slice(0, 77)}...` : path;
    throw new SvgParseError(
      `could not read "${shown}" as an SVG file. It does not start with "<", so it was taken as a ` +
        `path: ${(error as Error).message}`,
    );
  }
}

/**
 * An SVG drawing placed in the layout like an image.
 *
 * Unlike a bitmap it needs no decoder, so its intrinsic size is known SYNCHRONOUSLY, in the
 * constructor - which also means a broken file fails on the line that asked for it rather than deep
 * inside a later render, the same bargain `addFont` makes. An SVG from a URL is the exception: like
 * an image from a URL it is fetched when the document renders (`resolveIntrinsicSize`, or the
 * renderer for a subtree built during layout), and a dead link stops the render naming it.
 */
export class SvgElement extends SizedPDFElement {
  private source?: string;
  private intrinsic?: SvgSize;
  private readonly url?: string;
  private loading?: Promise<void>;
  private failed = false;
  private alt?: string;
  private requested: { width?: number; height?: number };
  private sizing: SizingParams;
  private widthFactor?: number;
  private heightFactor?: number;

  constructor(params: SvgElementParams) {
    super({ x: 0, y: 0, width: params.width, height: params.height });
    const { source, alt, widthFactor, heightFactor, ...sizing } = params;
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    if (typeof source === "string" && isImageUrl(source)) this.url = source;
    else
      this.parse(
        typeof source === "string"
          ? looksLikeMarkup(source)
            ? source
            : new TextDecoder().decode(readSource(source))
          : new TextDecoder().decode(source),
      );
    this.alt = alt;
    this.sizing = sizing;
    this.requested = { width: params.width, height: params.height };
  }

  /**
   * Parsed on purpose where the source is given: an unreadable file is an error where it was NAMED,
   * not inside a render three call frames later. The whole document is walked, not just its root, so
   * an element outside the subset surfaces here too. A logo parses in well under a millisecond.
   */
  private parse(source: string): void {
    this.intrinsic = svgSize(source);
    svgToIr(source, { x: 0, y: 0, width: 1, height: 1 });
    this.source = source;
  }

  /**
   * Fetches and parses an SVG from a URL - once per render, however often it is asked. A no-op
   * otherwise. A failure sticks for that render only: `fresh` (a new render begins) asks again.
   */
  async load(fresh = false): Promise<void> {
    const url = this.url;
    if (url === undefined) return;
    if (fresh && this.failed) this.loading = undefined;
    this.loading ??= fetchBytes(url, "SVG", ImageUrlError, IMAGE_FETCH_LIMITS)
      .then((bytes) => {
        try {
          this.parse(new TextDecoder().decode(bytes));
        } catch (e) {
          throw new ImageUrlError(
            `the SVG at ${url} could not be read: ${String((e as Error)?.message ?? e)}`,
          );
        }
      })
      .then(
        () => {
          this.failed = false;
        },
        (e: unknown) => {
          this.failed = true;
          throw e;
        },
      );
    await this.loading;
  }

  /**
   * The pre-layout pass, as for an `ImageElement`: best-effort, so a failure leaves the size unknown
   * and the renderer, which loads again, surfaces the real error.
   */
  async resolveIntrinsicSize(): Promise<void> {
    try {
      await this.load(true); // a render begins here
    } catch {
      // the renderer reports it
    }
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      source: this.source,
      intrinsic: this.intrinsic,
      alt: this.alt,
    };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    const size = this.sizeFor(constraints);
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  protected override computeSize(constraints: BoxConstraints): Size {
    return this.sizeFor(constraints);
  }

  /** Its size under these constraints - the one computation both `measure` and layout use. */
  private sizeFor(constraints: BoxConstraints): Size {
    const specs = extentSpecs({
      ...this.sizing,
      width: this.requested.width,
      height: this.requested.height,
      widthFactor: this.widthFactor,
      heightFactor: this.heightFactor,
    });
    const resolved = resolveSize(specs.width, specs.height, this.sizing.aspectRatio, constraints);
    let w = resolved.width;
    let h = resolved.height;
    const bounds = resolved.constraints;

    // An SVG from a URL that was never fetched sits in content built DURING layout (a PageBuilder, an auto
    // table column), which the pass before layout cannot reach. Its ratio is unknown here, so it needs
    // its whole box - a named error instead of a drawing sized to nothing. A FAILED fetch is not this
    // case: the renderer reports that one by its URL.
    if (
      this.url !== undefined &&
      this.loading === undefined &&
      (w === undefined || h === undefined)
    ) {
      throw new ImageUrlError(
        `the SVG at ${this.url} sits in content built during layout (a PageBuilder or an auto table ` +
          `column), where its size cannot be read before it is placed - give it both a width and a ` +
          `height, or an aspectRatio`,
      );
    }
    // One pinned axis derives the other from the drawing's own ratio (CSS `width: 120; height: auto`).
    // A bitmap needs a decode pass before it can do this; an SVG knows it from its viewBox.
    const intrinsic = this.intrinsic ?? { width: 0, height: 0 };
    if (this.sizing.aspectRatio === undefined && intrinsic.width > 0 && intrinsic.height > 0) {
      const ratio = intrinsic.width / intrinsic.height;
      if (w !== undefined && h === undefined) h = bounds.constrainHeight(w / ratio);
      else if (h !== undefined && w === undefined) w = bounds.constrainWidth(h * ratio);
    }

    // Nothing pinned: draw at the intrinsic size, as an unsized `<img>` does - never fill the region,
    // which would blow a 24pt icon up to the whole page.
    return {
      width: w ?? bounds.constrainWidth(intrinsic.width),
      height: h ?? bounds.constrainHeight(intrinsic.height),
    };
  }
}
