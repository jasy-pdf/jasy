import { Color } from "../common/color.ts";

/**
 * Every way to name a color. The FORM picks the convention, so there is never a guess
 * (locked design §2):
 *
 * | form                      | example                  | meaning                        |
 * |---------------------------|--------------------------|--------------------------------|
 * | named (full CSS set)      | `"steelblue"`, `"transparent"` | the ~148 CSS color names |
 * | hex 6 / 3                 | `"#1450aa"` / `"#14a"`   | CSS RGB                        |
 * | hex 8 / 4                 | `"#1450aacc"` / `"#14ac"`| CSS RGBA (alpha LAST)          |
 * | number                    | `0xff1450aa`             | Flutter ARGB (alpha FIRST)     |
 * | `rgb()` / `rgba()`        | `rgb(20,90,170)`         | channels 0–255 (`rgba` a=0–1)  |
 * | `Color` instance          | `new Color(20,90,170)`   | the engine layer, still valid  |
 */
export type ColorInput = string | number | Color;

/** Channels 0–255, fully opaque. */
export function rgb(r: number, g: number, b: number): Color {
  return new Color(r, g, b, 1);
}

/** Channels 0–255, alpha 0–1. */
export function rgba(r: number, g: number, b: number, a: number): Color {
  return new Color(r, g, b, a);
}

/**
 * Normalizes any `ColorInput` to an engine `Color`. The single funnel every factory uses,
 * so a color means the same thing no matter how it was written.
 */
export function toColor(input: ColorInput): Color {
  if (input instanceof Color) return input;
  if (typeof input === "number") return fromArgbNumber(input);

  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) return fromHex(s);

  const named = CSS_COLORS[s];
  if (named) return new Color(named[0], named[1], named[2], named[3] ?? 1);

  const call = /^([a-z-]+)\(([^)]*)\)$/.exec(s);
  if (call) return fromFunction(call[1]!, call[2]!, input);

  throw new Error(`Unknown color: "${input}"`);
}

/**
 * The CSS colour FUNCTIONS. `rgb()`/`rgba()` and `hsl()`/`hsla()` are the sRGB family, so they convert
 * exactly and are supported; a wide-gamut function (`color()`, `lab()`, `oklch()`) is named and
 * refused rather than silently squashed into sRGB, since the result would be a colour nobody chose.
 *
 * Both syntaxes are accepted, because both occur in the wild: the legacy comma form
 * `rgb(20, 90, 170)` and the modern space form with an optional slash-alpha `rgb(20 90 170 / 50%)`.
 */
function fromFunction(name: string, body: string, original: ColorInput): Color {
  if (name !== "rgb" && name !== "rgba" && name !== "hsl" && name !== "hsla") {
    throw new Error(
      `Unsupported color function "${name}()" in "${String(original)}". ` +
        `Use a hex value, a CSS colour name, rgb()/rgba() or hsl()/hsla().`,
    );
  }
  const [main, alphaPart] = body.split("/");
  const parts = main!
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const alphaText = alphaPart !== undefined ? alphaPart.trim() : parts[3];
  if (parts.length < 3) throw new Error(`Unknown color: "${String(original)}"`);

  const alpha = alphaText === undefined ? 1 : ratio(alphaText, original);
  const [a, b, c] = parts as [string, string, string];
  if (name === "rgb" || name === "rgba") {
    return new Color(channel(a, original), channel(b, original), channel(c, original), alpha);
  }
  const [r, g, bl] = hslToRgb(number(a, original), ratio(b, original), ratio(c, original));
  return new Color(r, g, bl, alpha);
}

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * One component of a colour function. `Number.parseFloat` stops at the first character it cannot use
 * and returns what it had, so `rgb(20abc, 90, 170)` would silently become `rgb(20, 90, 170)` - a
 * colour nobody wrote. The whole token has to be a number.
 */
function number(text: string, original: ColorInput): number {
  const t = text.trim();
  if (!NUMERIC.test(t)) throw new Error(`Unknown color: "${String(original)}"`);
  return Number(t);
}

/** An rgb channel: 0-255, or a percentage of 255. */
const channel = (text: string, original: ColorInput): number =>
  text.trim().endsWith("%")
    ? (number(text.trim().slice(0, -1), original) / 100) * 255
    : number(text, original);

/** A 0..1 ratio written either as a number or as a percentage (alpha, saturation, lightness). */
const ratio = (text: string, original: ColorInput): number =>
  text.trim().endsWith("%")
    ? number(text.trim().slice(0, -1), original) / 100
    : number(text, original);

/** CSS hue-saturation-lightness to 0-255 channels. */
function hslToRgb(hue: number, s: number, l: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const rgbPrime: [number, number, number] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] as [number, number, number];
  return rgbPrime.map((v) => Math.round((v + m) * 255)) as [number, number, number];
}

/** Flutter ARGB: 0xAARRGGBB, alpha FIRST. A 6-digit number has alpha 0x00 = transparent. */
function fromArgbNumber(n: number): Color {
  const a = (n >>> 24) & 0xff;
  const r = (n >>> 16) & 0xff;
  const g = (n >>> 8) & 0xff;
  const b = n & 0xff;
  return new Color(r, g, b, a / 255);
}

/** CSS hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA. Alpha is LAST. */
function fromHex(s: string): Color {
  const hex = s.slice(1);
  const expand = (h: string) =>
    h
      .split("")
      .map((c) => c + c)
      .join("");

  let full: string;
  if (hex.length === 3 || hex.length === 4) full = expand(hex);
  else if (hex.length === 6 || hex.length === 8) full = hex;
  else throw new Error(`Invalid hex color: "${s}"`);

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  if ([r, g, b].some(Number.isNaN)) throw new Error(`Invalid hex color: "${s}"`);
  return new Color(r, g, b, a);
}

// The full CSS named-color set (~148, incl. the synonyms grey/gray and `transparent`).
// [r, g, b] or [r, g, b, alpha]. Lower-cased keys; `toColor` lower-cases the input.
const CSS_COLORS: Record<string, [number, number, number] | [number, number, number, number]> = {
  transparent: [0, 0, 0, 0],
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  aqua: [0, 255, 255],
  aquamarine: [127, 255, 212],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  bisque: [255, 228, 196],
  black: [0, 0, 0],
  blanchedalmond: [255, 235, 205],
  blue: [0, 0, 255],
  blueviolet: [138, 43, 226],
  brown: [165, 42, 42],
  burlywood: [222, 184, 135],
  cadetblue: [95, 158, 160],
  chartreuse: [127, 255, 0],
  chocolate: [210, 105, 30],
  coral: [255, 127, 80],
  cornflowerblue: [100, 149, 237],
  cornsilk: [255, 248, 220],
  crimson: [220, 20, 60],
  cyan: [0, 255, 255],
  darkblue: [0, 0, 139],
  darkcyan: [0, 139, 139],
  darkgoldenrod: [184, 134, 11],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  darkgreen: [0, 100, 0],
  darkkhaki: [189, 183, 107],
  darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47],
  darkorange: [255, 140, 0],
  darkorchid: [153, 50, 204],
  darkred: [139, 0, 0],
  darksalmon: [233, 150, 122],
  darkseagreen: [143, 188, 143],
  darkslateblue: [72, 61, 139],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  darkturquoise: [0, 206, 209],
  darkviolet: [148, 0, 211],
  deeppink: [255, 20, 147],
  deepskyblue: [0, 191, 255],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  dodgerblue: [30, 144, 255],
  firebrick: [178, 34, 34],
  floralwhite: [255, 250, 240],
  forestgreen: [34, 139, 34],
  fuchsia: [255, 0, 255],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  gold: [255, 215, 0],
  goldenrod: [218, 165, 32],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  green: [0, 128, 0],
  greenyellow: [173, 255, 47],
  honeydew: [240, 255, 240],
  hotpink: [255, 105, 180],
  indianred: [205, 92, 92],
  indigo: [75, 0, 130],
  ivory: [255, 255, 240],
  khaki: [240, 230, 140],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  lawngreen: [124, 252, 0],
  lemonchiffon: [255, 250, 205],
  lightblue: [173, 216, 230],
  lightcoral: [240, 128, 128],
  lightcyan: [224, 255, 255],
  lightgoldenrodyellow: [250, 250, 210],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightsalmon: [255, 160, 122],
  lightseagreen: [32, 178, 170],
  lightskyblue: [135, 206, 250],
  lightslategray: [119, 136, 153],
  lightslategrey: [119, 136, 153],
  lightsteelblue: [176, 196, 222],
  lightyellow: [255, 255, 224],
  lime: [0, 255, 0],
  limegreen: [50, 205, 50],
  linen: [250, 240, 230],
  magenta: [255, 0, 255],
  maroon: [128, 0, 0],
  mediumaquamarine: [102, 205, 170],
  mediumblue: [0, 0, 205],
  mediumorchid: [186, 85, 211],
  mediumpurple: [147, 112, 219],
  mediumseagreen: [60, 179, 113],
  mediumslateblue: [123, 104, 238],
  mediumspringgreen: [0, 250, 154],
  mediumturquoise: [72, 209, 204],
  mediumvioletred: [199, 21, 133],
  midnightblue: [25, 25, 112],
  mintcream: [245, 255, 250],
  mistyrose: [255, 228, 225],
  moccasin: [255, 228, 181],
  navajowhite: [255, 222, 173],
  navy: [0, 0, 128],
  oldlace: [253, 245, 230],
  olive: [128, 128, 0],
  olivedrab: [107, 142, 35],
  orange: [255, 165, 0],
  orangered: [255, 69, 0],
  orchid: [218, 112, 214],
  palegoldenrod: [238, 232, 170],
  palegreen: [152, 251, 152],
  paleturquoise: [175, 238, 238],
  palevioletred: [219, 112, 147],
  papayawhip: [255, 239, 213],
  peachpuff: [255, 218, 185],
  peru: [205, 133, 63],
  pink: [255, 192, 203],
  plum: [221, 160, 221],
  powderblue: [176, 224, 230],
  purple: [128, 0, 128],
  rebeccapurple: [102, 51, 153],
  red: [255, 0, 0],
  rosybrown: [188, 143, 143],
  royalblue: [65, 105, 225],
  saddlebrown: [139, 69, 19],
  salmon: [250, 128, 114],
  sandybrown: [244, 164, 96],
  seagreen: [46, 139, 87],
  seashell: [255, 245, 238],
  sienna: [160, 82, 45],
  silver: [192, 192, 192],
  skyblue: [135, 206, 235],
  slateblue: [106, 90, 205],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
  snow: [255, 250, 250],
  springgreen: [0, 255, 127],
  steelblue: [70, 130, 180],
  tan: [210, 180, 140],
  teal: [0, 128, 128],
  thistle: [216, 191, 216],
  tomato: [255, 99, 71],
  turquoise: [64, 224, 208],
  violet: [238, 130, 238],
  wheat: [245, 222, 179],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
  yellow: [255, 255, 0],
  yellowgreen: [154, 205, 50],
};
