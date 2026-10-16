import { Column, Row, Box, Text } from "../../../src/lib/index.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";

/** 48 leaves grouped in pairs, level by level: Column, then a bordered Box, then a Row of Boxes. */
export const deeplyNested = (depth: number) => {
  const wrap = (kids: PDFElement[], level: number): PDFElement =>
    level % 3 === 0
      ? Column({ gap: 2 }, kids)
      : level % 3 === 1
        ? Box({ padding: 2, border: "gray" }, [Column({ gap: 1 }, kids)])
        : Row(
            { gap: 2 },
            kids.map((k) => Box({}, [k])),
          );
  let nodes: PDFElement[] = Array.from({ length: 48 }, (_, i) => Text(`leaf ${i}`, { size: 7 }));
  for (let level = 0; level < depth; level++) {
    const grouped: PDFElement[] = [];
    for (let i = 0; i < nodes.length; i += 2) grouped.push(wrap(nodes.slice(i, i + 2), level));
    nodes = grouped.length > 1 && level < depth - 1 ? grouped : [wrap(grouped, level)];
  }
  return nodes;
};
