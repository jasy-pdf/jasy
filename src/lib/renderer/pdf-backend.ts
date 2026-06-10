import { IRNode } from "../ir/display-list";
import { PDFObjectManager } from "../utils/pdf-object-manager";

/**
 * PDF backend - turns display-list primitives into content-stream operators.
 *
 * This is "the renderer" in the pure sense: it consumes only `IRNode`s and knows
 * nothing about components. Each primitive maps to the exact operators previously
 * emitted inline by the per-element renderers, so output stays byte-identical while
 * the renderers are migrated onto the IR one at a time.
 */
export class PdfBackend {
  /**
   * Flip a display list from the engine's top-left origin (y grows downward) to PDF's
   * bottom-left origin (y grows upward). This is the ONE place the Y axis is flipped -
   * elements above this seam are coordinate-system-blind. Each primitive flips around
   * its own anchor: a rect/image around its bottom edge, a text baseline / line point
   * directly. (image is migrated in a later slice and still arrives pre-flipped.)
   */
  static flipY(nodes: IRNode[], pageHeight: number): IRNode[] {
    return nodes.map((node) => {
      switch (node.type) {
        case "rect":
          return { ...node, y: pageHeight - node.y - node.height };
        case "line":
          return {
            ...node,
            y1: pageHeight - node.y1,
            y2: pageHeight - node.y2,
          };
        case "text":
          // node.y is the baseline measured from the page top; flip it directly.
          return { ...node, y: pageHeight - node.y };
        case "image": {
          // Flip the placement box (and the clip frame, if any) around its bottom edge.
          const flipped = { ...node, y: pageHeight - node.y - node.height };
          if (node.clip) {
            flipped.clip = {
              ...node.clip,
              y: pageHeight - node.clip.y - node.clip.height,
            };
          }
          return flipped;
        }
        default: {
          const unknown: never = node;
          return unknown;
        }
      }
    });
  }

  /** Serialize a whole display list into one content stream (page-level entry point). */
  static serialize(nodes: IRNode[], om: PDFObjectManager): string {
    return nodes.map((node) => PdfBackend.serializeNode(node, om)).join("");
  }

  /**
   * Serialize a single display-list node to its content-stream operators.
   * `om` is used only by primitives that allocate PDF resources (images, fonts).
   */
  static serializeNode(node: IRNode, om: PDFObjectManager): string {
    switch (node.type) {
      case "line":
        // q/Q isolates the graphics state; "[] 0 d" resets the dash pattern to solid.
        return (
          `q\n` +
          `${node.strokeWidth} w\n` +
          `${node.stroke.toPDFColorString()} RG\n` +
          `[] 0 d\n` +
          `${node.x1} ${node.y1} m\n` +
          `${node.x2} ${node.y2} l\n` +
          `S\n` +
          `Q\n`
        );
      case "rect": {
        // Stroke state first, then optional fill color, then paint: B = fill+stroke,
        // f = fill only, S = stroke only.
        let ops = "";
        if (node.stroke) {
          ops += `${node.strokeWidth} w\n${node.stroke.toPDFColorString()} RG\n`;
        }
        if (node.fill) ops += `${node.fill.toPDFColorString()} rg\n`;
        const paint = node.fill ? (node.stroke ? "B" : "f") : "S";
        return ops + `${node.x} ${node.y} ${node.width} ${node.height} re ${paint}\n`;
      }
      case "text": {
        // One self-contained text block per run. The producer has already resolved
        // absolute position, font and color; the backend only allocates the font
        // resource and emits the operators. Text is not escaped here - that matches
        // the previous behavior and is a separate fix (see todo).
        const font = om.registerFont(node.fontFamily, node.fontStyle);
        return (
          `BT\n` +
          `${node.color.toPDFColorString()} rg ` +
          `/F${font.fontIndex} ${node.fontSize} Tf ` +
          `${node.x.toFixed(3)} ${node.y.toFixed(3)} Td ` +
          `(${node.text}) Tj\n` +
          `ET\n`
        );
      }
      case "image": {
        // The backend owns PDF resource creation: register the XObject (using the
        // source pixel dimensions) and then place it with a scaling matrix.
        const ref = om.registerImage(
          node.intrinsicWidth,
          node.intrinsicHeight,
          node.imageType,
          node.data
        );
        const draw =
          `q\n${node.width} 0 0 ${node.height} ${node.x} ${node.y} cm\n` +
          `/IM${ref} Do\nQ\n`;
        if (!node.clip) return draw;
        // cover/contain clip the placement to the original frame (re … W n).
        const c = node.clip;
        return `q\n${c.x} ${c.y} ${c.width} ${c.height} re \nW n \n` + draw + `Q\n`;
      }
      default: {
        // Exhaustiveness guard: if a new IRNode variant is added, this fails to compile.
        const unknown: never = node;
        throw new Error(`PdfBackend: unhandled IR node ${JSON.stringify(unknown)}`);
      }
    }
  }
}
