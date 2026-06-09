// Leaf module: no imports, so it can never sit inside an import cycle. The page/color
// enums live here because they are runtime values used across modules that DO form
// cycles (object manager <-> document <-> elements); importing them from a cyclic
// module snapshots them as `undefined` under some load orders.

export enum Orientation {
  portrait = "PORTRAIT",
  landscape = "LANDSCAPE",
}

export enum ColorMode {
  color = "COLOR",
  grayscale = "GRAYSCALE",
}
