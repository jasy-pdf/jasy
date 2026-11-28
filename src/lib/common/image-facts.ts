// What a source image IS, read from its bytes: shared by the loader, the producers and the IR.

/**
 * EXIF orientation: 2 mirrored, 3 turned half, 4 flipped, 5 transposed, 6 turned a quarter clockwise,
 * 7 transversed, 8 turned a quarter counterclockwise. 5-8 swap width and height.
 */
export type Orientation = 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** The colors an image's samples are in. */
export type ImageColorSpace = "gray" | "rgb" | "cmyk";

/** What an image's samples mean: their color space, and whether they are stored inverted. */
export interface ImageColor {
  space: ImageColorSpace;
  /** Photoshop stores CMYK inverted (an Adobe `APP14` segment). */
  inverted?: boolean;
}
