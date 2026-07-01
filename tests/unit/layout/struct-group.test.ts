import { describe, it, expect } from "vitest";
import { StructGroup } from "../../../src/lib/elements/layout/struct-group";
import { isFragmentable, packChildren } from "../../../src/lib/layout/fragmentation";
import { Row, Column, Box } from "../../../src/lib/api/layout";
import { Text } from "../../../src/lib/api/text";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { DEFAULT_TEXT_STYLE } from "../../../src/lib/text/text-style";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element";

const om = new PDFObjectManager();
const ctx: LayoutContext = {
  metrics: om,
  pageConfig: om.getPDFConfig(),
  textStyle: DEFAULT_TEXT_STYLE,
  onOverflow: "ignore",
};

describe("StructGroup fragmentation transparency", () => {
  it("is NOT fragmentable around a non-fragmentable child (a table row moves whole, not clipped)", () => {
    const row = Row({}, []); // a Row is atomic (not fragmentable)
    expect(isFragmentable(row)).toBe(false);
    expect(isFragmentable(new StructGroup("TR", row))).toBe(false);
  });

  it("IS fragmentable around a fragmentable child (the table body paginates)", () => {
    const col = Column({}, [Text("x")]); // a Column fragments (paginates its children)
    expect(isFragmentable(col)).toBe(true);
    expect(isFragmentable(new StructGroup("Table", col))).toBe(true);
  });

  // The actual regression: a tagged table row that doesn't fit must move WHOLE to the next page, never be
  // clipped onto the current one. (Before the canFragment fix, the StructGroup(TR) claimed to be splittable,
  // so packChildren force-placed the whole - too-tall - row into `fitted` and it rendered clipped.)
  it("a tagged row that doesn't fit moves whole to the next page (never clipped)", () => {
    const tr = () => new StructGroup("TR", Row({}, [Box({ width: 50, height: 100 }, [])]));
    const rows = [tr(), tr(), tr()]; // 100pt tall each
    const { fitted, remainder } = packChildren(rows, 250, 200, ctx, 0); // region holds exactly two rows
    expect(fitted).toHaveLength(2); // two whole rows fit
    expect(remainder).toHaveLength(1); // the third moved whole - NOT clipped into `fitted`
  });
});
