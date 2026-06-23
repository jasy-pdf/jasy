// A full-bleed cover page: the background runs edge to edge (no page margin), a bold accent disc pokes
// off the corner and is cropped by overflow:hidden, and the text sits on top - all driven by the
// positioning layer (a relative Box frame + out-of-flow Positioned children).
import { Document, Page, Box, Expanded, Positioned, Column, Text, Paragraph, Divider } from "@jasy/pdf";

const navy = "#0a2348";
const navy2 = "#13315f";
const accent = "#f3dc29";
const white = "#ffffff";
const soft = "#9db8e0";

const LEAD =
  "You describe a document as a tree of components and jasy lays it out and writes the PDF bytes " +
  "itself, with no headless browser and no Java. Text breaks at real font metrics, images move as a " +
  "whole across a page break, and the background you see here bleeds past the page margin because a " +
  "Positioned child is allowed to poke right out to the paper's edge.";

export default Document([
  Page({ margin: 0 }, [
    Expanded(
      Box({ bg: navy, relative: true, overflow: "hidden" }, [
        // subtle disc for depth (bottom-left), then the bold accent disc cropped at the top-right corner
        Positioned({ bottom: -170, left: -130 }, Box({ width: 380, height: 380, radius: 190, bg: navy2 }, [])),
        Positioned({ top: -130, right: -120 }, Box({ width: 300, height: 300, radius: 150, bg: accent }, [])),

        // content, inset from the edges
        Positioned(
          { top: 220, left: 80, right: 80 },
          Column({ gap: 16 }, [
            Text("PURE TYPESCRIPT · ZERO DEPENDENCIES", { size: 11, bold: true, color: accent }),
            Text("Documents that flow, by design.", { size: 40, bold: true, color: white }),
            Divider({ color: navy2 }),
            Paragraph(LEAD, { size: 13, color: soft, font: "Times-Roman" }),
          ]),
        ),

        // a corner mark, anchored to the frame
        Positioned({ bottom: 48, right: 56 }, Text("jasy · 01", { size: 11, bold: true, color: accent })),
      ]),
    ),
  ]),
]);
