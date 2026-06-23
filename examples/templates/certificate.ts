// A certificate - the showcase for custom TrueType embedding. The recipient name is set in Great
// Vibes (an OFL calligraphy font, subsetted + embedded as Type0/Identity-H); everything else uses the
// standard fonts. doc.addFont(name, ttfPath) registers it; Text({ font: name }) uses it.
// The gold frame is an out-of-flow Positioned border filling the page content box (so it keeps an
// equal margin on all four sides), and the content is centered inside it.
import { Document, Page, Column, Row, Box, Padding, Positioned, Text } from "@jasy/pdf";

const ink = "#1b2433";
const muted = "#6b7280";
const brand = "#1450aa";
const gold = "#a8842c";

const rule = (w: number) => Box({ width: w, height: 1.4, bg: gold }, []);
const spaced = (s: string) => s.split("").join(String.fromCharCode(32)); // letter-spaced title

const doc = Document([
  Page({ size: "A4", orientation: "landscape", margin: 46, justify: "center", align: "center" }, [
    // the frame: a border filling the content box, out of flow so it never shifts the content
    Positioned({ top: 0, left: 0, right: 0, bottom: 0 }, Box({ border: gold, borderWidth: 1.5, radius: 6 }, [])),

    // the content, centered in the frame
    Padding(
      { x: 56 },
      Column({ align: "center", gap: 0 }, [
        Text(spaced("CERTIFICATE"), { font: "Times-Roman", bold: true, size: 26, color: ink, align: "center" }),
        Box({ height: 5 }, []),
        Text(spaced("OF ACHIEVEMENT"), { font: "Times-Roman", size: 11, color: gold, align: "center" }),

        Box({ height: 34 }, []),
        Text("This certificate is proudly presented to", { font: "Times-Roman", size: 13, color: muted, align: "center" }),
        Box({ height: 8 }, []),
        Text("Florian Heuberger", { font: "Great Vibes", size: 60, color: brand, align: "center" }),
        Box({ height: 8 }, []),
        rule(160),

        Box({ height: 26 }, []),
        Text("in recognition of building jasy, a declarative PDF engine in pure TypeScript,", { font: "Times-Roman", size: 12, color: ink, align: "center" }),
        Text("ZUGFeRD-conformant, with no headless browser and no Java underneath.", { font: "Times-Roman", size: 12, color: ink, align: "center" }),

        Box({ height: 46 }, []),
        Row({ justify: "between", align: "end" }, [
          Column({ align: "center", gap: 3 }, [rule(160), Text("Erika Muster · Founder", { font: "Times-Roman", size: 9, color: muted })]),
          Box({ width: 18, height: 18, radius: 9, border: gold, borderWidth: 1.5 }, []),
          Column({ align: "center", gap: 3 }, [rule(160), Text("Berlin · 24 June 2026", { font: "Times-Roman", size: 9, color: muted })]),
        ]),
      ]),
    ),
  ]),
]);

doc.addFont("Great Vibes", "examples/assets/fonts/GreatVibes-Regular.ttf");

export default doc;
