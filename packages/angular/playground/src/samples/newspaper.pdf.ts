import type { PdfDocument } from "@jasy/angular";
import {
  Box,
  Column,
  ColumnBreak,
  Document,
  Expanded,
  Flow,
  Page,
  PageBreak,
  PageCount,
  PageNumber,
  Region,
  Row,
  SplitView,
  Table,
  Text,
  keepTogether,
} from "@jasy/pdf";

const NEWS = [
  "Rail freight volumes rose for the third quarter in a row, driven by container traffic between the North Sea ports and the inland terminals.",
  "Operators report that most new capacity went to night slots, which leaves daytime passenger timetables untouched for now.",
  "The regional council approved the second phase of the harbor bridge, with construction expected to start in early spring.",
  "Local bakeries have joined forces to buy flour directly from three mills in the valley, cutting their costs by almost a tenth.",
  "Weather services expect a dry autumn, which helps the late harvest but worries the shipping companies on the upper river.",
  "Schools in the district will test a four-day week for older students, with the fifth day reserved for projects and internships.",
];
const story = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `${NEWS[(from + i) % 6]} ${NEWS[(from + i + 2) % 6]}`);
const paragraphs = (n: number, from?: number, size?: number) =>
  story(n, from).map((p) => Text(p, { size }));

const PRICES = Array.from({ length: 12 }, (_, i) => ({
  lot: `${["Wheat", "Barley", "Rye", "Oats"][i % 4]} lot ${i + 1}`,
  price: (180 + i * 7.5).toFixed(2),
}));
const BUDGET = Array.from({ length: 10 }, (_, i) => ({
  project: `Project ${String.fromCharCode(65 + i)}`,
  amount: `${(1.2 + i * 0.35).toFixed(2)} m`,
  status: i % 3 ? "on track" : "delayed",
}));

const muted = { size: 7, color: "#94a3b8" };
const footer = Row([
  Expanded(Text("The Valley Courier", muted)),
  Row({ gap: 3 }, [Text("Page", muted), PageNumber(muted), Text("of", muted), PageCount(muted)]),
]);

const headline = (text: string) => Text(text, { size: 13, bold: true, color: "#1450aa" });
const small = (text: string) => Text(text, { size: 8 });

export const newspaperPdf: PdfDocument = () =>
  Document({ size: 9, lineHeight: 1.4, color: "#1f2937" }, [
    Page({ size: "A4", margin: 36, gap: 10, footer }, [
      // Newspaper columns: no layout to write.
      Text("THE VALLEY COURIER", { size: 30, bold: true, color: "#1450aa" }),
      Box({ height: 1.5, bg: "#1450aa" }, []),
      SplitView({ columns: 3, colGap: 16, rowGap: 7 }, [
        keepTogether([headline("Freight on the rise"), Text(story(1)[0])]),
        ...paragraphs(4, 1),
        Box({ bg: "#eef3fb", padding: 8, radius: 3 }, [
          Text('"We plan for the river we have, not the river we wish for."', {
            size: 11,
            italic: true,
            color: "#1450aa",
          }),
        ]),
        ...paragraphs(3, 5),
        headline("Market prices"),
        Table(
          { columns: ["1fr", "auto"], cellPadding: 3, rule: "#c8d3e8", header: ["Lot", "EUR/t"] },
          PRICES.map((r) => [r.lot, r.price]),
        ),
        ...paragraphs(4, 2),
        ColumnBreak(),
        keepTogether([headline("Schools try a four-day week"), Text(story(1, 3)[0])]),
        ...paragraphs(8, 4),
      ]),
      Text("This line follows the columns, right where they end.", { size: 10, italic: true }),

      // A layout of your own: `template` draws one page of the Flow, each Region a place the content flows.
      PageBreak(),
      Flow(
        {
          gap: 8,
          template: ({ index }) =>
            Box({ border: "#1450aa", padding: 12, radius: 4 }, [
              Column({ gap: 10 }, [
                index === 0
                  ? Text("Annual Infrastructure Report", { size: 18, bold: true, color: "#1450aa" })
                  : Text("Annual Infrastructure Report, continued", {
                      size: 8,
                      italic: true,
                      color: "#1450aa",
                    }),
                Row({ gap: 14 }, [
                  Expanded(Region()),
                  Box({ bg: "#f3f5f9", padding: 8 }, [Region({ width: 150 })]),
                ]),
              ]),
            ]),
        },
        [
          Text("Summary", { size: 12, bold: true }),
          ...paragraphs(4, 0, 10),
          Text("Two-column detail", { size: 12, bold: true }),
          SplitView({ columns: 2, colGap: 12, rowGap: 6 }, paragraphs(6, 4)),
          Text("Budget", { size: 12, bold: true, color: "#1450aa" }),
          Table(
            {
              columns: ["1fr", "auto", "auto"],
              cellPadding: 3,
              cellBorder: "#bbb",
              header: ["Project", "Budget", "Status"],
            },
            BUDGET.map((b) => [small(b.project), small(b.amount), small(b.status)]),
          ),
          ...paragraphs(5, 1, 10),
          ColumnBreak(),
          Text("Notes", { size: 11, bold: true, color: "#1450aa" }),
          ...paragraphs(6, 2, 8),
        ],
      ),
      Text("End of report.", { size: 10, italic: true }),
    ]),
  ]);
