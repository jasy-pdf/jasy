// A promo banner in a different format (A5 landscape): a raster image fills the page edge to edge
// (BoxFit cover, cropped by overflow:hidden), with the message positioned on top. Shows the image
// layer + a non-A4 format. Everything is out-of-flow (Positioned) inside an Expanded relative frame,
// so the frame fills the page cleanly - the same pattern as the cover page.
import { Document, Page, Box, Expanded, Positioned, Column, Text, Image } from "@jasy/pdf";

const white = "#ffffff";
const soft = "#cdddf5";
const accent = "#f3dc29";

// A5 landscape = 595.28 x 419.53 pt (148 x 210 mm)

export default Document([
  Page({ size: "A5", orientation: "landscape", margin: 0 }, [
    Expanded(
      Box({ relative: true, overflow: "hidden" }, [
        // full-bleed background image: sized a touch over the page and cropped to a clean bleed by
        // overflow:hidden. A Positioned child is out of flow, so even oversized it never paginates.
        Positioned({ top: 0, left: 0 }, Image("examples/assets/banner.png", { width: 600, height: 425, fit: "cover" })),

        // message
        Positioned(
          { top: 64, left: 56, right: 56 },
          Column({ gap: 12 }, [
            Text("PURE TYPESCRIPT  ·  ZERO DEPENDENCIES", { size: 11, bold: true, color: accent }),
            Column({ gap: 2 }, [
              Text("Make beautiful PDFs", { size: 34, bold: true, color: white }),
              Text("straight from components.", { size: 34, bold: true, color: white }),
            ]),
            Text("No headless browser, no Java. Just a tree of components and real font metrics.", {
              size: 13,
              color: soft,
              lineHeight: 1.35,
            }),
          ]),
        ),

        // footer marks, anchored to the frame corners
        Positioned({ bottom: 36, left: 56 }, Text("@jasy/pdf", { size: 12, bold: true, color: accent })),
        Positioned({ bottom: 36, right: 56 }, Text("v1.0  ·  MIT", { size: 11, color: soft })),
      ]),
    ),
  ]),
]);
