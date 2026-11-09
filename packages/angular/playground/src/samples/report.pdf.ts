import type { PdfDocument } from "@jasy/angular";
import {
  Box,
  Column,
  Document,
  Padding,
  Page,
  PageBuilder,
  Positioned,
  Row,
  Text,
} from "@jasy/pdf";

const TOPICS = [
  [
    "Executive summary",
    "Revenue grew 18% quarter over quarter, driven by the new self-serve tier. Churn held steady at 2.1%, and gross margin improved by three points after the infrastructure migration.",
  ],
  [
    "Acquisition",
    "Organic signups outpaced paid for the first time. The documentation rewrite and the in-browser playground are the two largest referrers, together accounting for 41% of new accounts.",
  ],
  [
    "Activation",
    "Time-to-first-render dropped from 9 minutes to under 2 after the quick-start template shipped. Teams that render a document in week one retain at nearly double the rate.",
  ],
  [
    "Retention",
    "Cohort curves flattened earlier than in any prior quarter. The invoice and report templates are the stickiest surfaces; accounts that adopt them rarely lapse.",
  ],
  [
    "Infrastructure",
    "The move to fully client-side rendering removed an entire service tier. Median render latency is now bound only by the client, and the egress bill fell accordingly.",
  ],
  [
    "Risks",
    "Single-format dependence remains the chief risk. Broadening the e-invoice profile coverage and shipping the framework bindings are the two mitigations on deck.",
  ],
  [
    "Outlook",
    "We expect the framework bindings to compound the acquisition gains. Conservative guidance holds the current growth rate.",
  ],
];

export const reportPdf: PdfDocument<{ sections: number }> = ({ sections }) => {
  // PageBuilder is called per page, once the page count is known.
  const header = Row({ justify: "between" }, [
    Text("ACME Analytics", { size: 12, bold: true, color: "#0a2348" }),
    PageBuilder(({ pageNumber, pageCount }) =>
      Text(
        pageNumber === 1
          ? "Quarterly Report · Q2 2026"
          : `continued · page ${pageNumber} of ${pageCount}`,
        { size: 12, color: "#64748b" },
      ),
    ),
  ]);
  const footer = Text("Confidential · © ACME GmbH · repeats on every page", {
    size: 9,
    color: "#94a3b8",
    align: "center",
  });

  return Document({ size: 11, color: "#1f2937", lineHeight: 1.4 }, [
    Page({ size: "A4", gap: 13, header, footer }, [
      Padding(
        { top: 15 },
        Box({ relative: true, bg: "#eef2ff", padding: 16, radius: 6 }, [
          Text("Performance Review", { size: 20, bold: true, color: "#0a2348" }),
          Positioned(
            { top: -10, right: -10 },
            Box({ bg: "#1450aa", padding: 6, radius: 12 }, [
              Text("DRAFT", { size: 9, bold: true, color: "#ffffff" }),
            ]),
          ),
        ]),
      ),

      ...Array.from({ length: sections }, (_, i) => {
        const [title, body] = TOPICS[i % TOPICS.length];
        return Column({ gap: 3, keepTogether: true }, [
          Text(`${i + 1}. ${title}`, { size: 13, bold: true, color: "#0a2348", role: "h2" }),
          Text(body, { align: "justify" }),
        ]);
      }),
    ]),
  ]);
};
