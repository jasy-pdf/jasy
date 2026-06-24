// A business letter - the showcase for inherited text styles. The Document sets the body typeface,
// size, colour and line-height ONCE; every paragraph below just inherits them (no per-Text styling).
// Blocks that need their own look (the contact line, the signature title, the confidentiality note)
// wrap a DefaultTextStyle that re-defaults only that subtree, still inheriting the font.
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Divider,
  Spacer,
  DefaultTextStyle,
  Text,
} from "@jasy/pdf";

const ink = "#1f2a37";
const brand = "#1450aa";
const muted = "#6b7280";
const hair = "#dfe4ee";

const gap = (h: number) => Box({ height: h }, []);

export default Document({ font: "Times-Roman", size: 11, color: ink, lineHeight: 1.5 }, [
  Page({ size: "A4", margin: 64 }, [
    // letterhead: brand wordmark + a muted contact block (its own default style)
    Row({ justify: "between", align: "end" }, [
      Text("Muster Studio", { size: 20, bold: true, color: brand }),
      DefaultTextStyle({ size: 9, color: muted }, [
        Column({ align: "end", gap: 1 }, [
          Text("Hauptstraße 1 · 10115 Berlin"),
          Text("kontakt@muster-studio.de"),
        ]),
      ]),
    ]),
    gap(10),
    Divider({ color: hair }),
    gap(26),

    Row({ justify: "end" }, [Text("Berlin, 24 June 2026")]),
    gap(20),

    Column({ gap: 2 }, [
      Text("Beispiel Kunde AG", { bold: true }),
      Text("Marienplatz 1"),
      Text("80331 München"),
    ]),
    gap(24),

    Text("Re: Your brand refresh - milestone two", { bold: true }),
    gap(16),

    Text("Dear Ms. Example,"),
    gap(10),
    Text(
      "thank you for the trust you have placed in our studio. The first phase of your brand " +
        "refresh is complete, and we are delighted with how the new identity has come together.",
    ),
    gap(8),
    Text(
      "Over the coming weeks we will prepare the design system and the component library, and " +
        "share a working preview with your team well ahead of the launch date. Should anything " +
        "need adjusting, there is ample room in the schedule to accommodate it.",
    ),
    gap(8),
    Text("We look forward to the next milestone and remain at your disposal for any questions."),
    gap(20),

    Text("Sincerely,"),
    gap(6),
    Text("Erika Muster", { bold: true }),
    DefaultTextStyle({ size: 9, color: muted }, [Text("Founder · Muster Studio")]),

    Spacer(),
    Divider({ color: hair }),
    gap(8),
    DefaultTextStyle({ size: 8.5, color: muted, lineHeight: 1.4 }, [
      Text(
        "This letter is confidential and intended solely for the addressee. If you have received " +
          "it in error, please notify the sender and delete it.",
      ),
    ]),
  ]),
]);
