import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import {
  PDFElement,
  FlexiblePDFElement,
  hasChildProp,
  SizedPDFElement,
} from "../elements/pdf-element.ts";

export class Validator {
  static validateDocument(document: PDFDocumentElement) {
    // More validation will be added later...
    document.getProps().children.forEach((page) => {
      page.getProps().children.forEach((element) => {
        if (element instanceof PDFDocumentElement) {
          throw new Error("PDFDocument cannot be nested inside another element.");
        }
      });
    });
  }

  static validateElement(element: PDFElement): void {
    // Structural validation
    if (element instanceof PDFDocumentElement) {
      throw new Error("PDFDocument cannot be nested inside another element.");
    }

    // Layout validation: geometry comes from the typed getSize(), not the props bag.
    if (element instanceof SizedPDFElement) {
      const { width, height } = element.getSize();
      // Negative coordinates are allowed: a `Positioned` child overflows its frame on purpose,
      // and the page clips anything past its edge. 0 size is legitimate (a hairline divider, an
      // empty spacer); only a NEGATIVE size is invalid.
      if ((width !== undefined && width < 0) || (height !== undefined && height < 0)) {
        throw new Error(
          `Element ${element.constructor.name} has invalid size (width: ${width}, height: ${height})`,
        );
      }
    }

    // Logical validation: Flexible and fixed elements
    if (element instanceof FlexiblePDFElement) {
      this.validateFlexElement(element);
    }
  }

  static validateSizedElement(element: SizedPDFElement): void {
    const { width, height } = element.getSize();
    // Negative coordinates are legitimate: a `Positioned` child overflows its frame on purpose
    // (a corner badge), and the page clips anything off its edge. A size must be set, but 0 is
    // legitimate (a hairline divider); only a NEGATIVE size is invalid.
    if (width === undefined || height === undefined || width < 0 || height < 0) {
      throw new Error(
        `Element ${element.constructor.name} has invalid size (width: ${width}, height: ${height})`,
      );
    }
  }

  static validateFlexElement(element: FlexiblePDFElement): void {
    // Ensure flexible elements have valid flex values. The message names what the CALLER wrote, not the
    // element class: `Spacer` and `Expanded` are what exists in their document, `ExpandedElement` is not.
    const flex = element.getFlex();
    // `flex: 0` used to be meaningless - claiming no share is what leaving the element out does. With a
    // `flexBasis` it is not: the child is then exactly its basis, a fixed slot that still participates
    // in the line. So the rule now reads "claim SOMETHING": a share, a basis, or both.
    if (flex < 0 || (flex === 0 && element.getBasis(Infinity) <= 0 && !element.hasBasisFactor())) {
      throw new Error(
        `@jasy/pdf: Spacer/Expanded needs a flex above 0, got ${flex}. Flex is a SHARE of the leftover ` +
          "space, so 0 would claim none - which is what leaving the element out does. For a fixed gap " +
          "use the `gap` of the surrounding Column or Row, or a Box with a height. (A `flexBasis` " +
          "makes `flex: 0` meaningful: the child is then exactly its basis.)",
      );
    }

    // Ensure a flexible element does not contain another flexible element
    if (hasChildProp<FlexiblePDFElement>(element)) {
      if (element.child instanceof FlexiblePDFElement) {
        throw new Error(
          `Flexible element ${element.constructor.name} cannot hold another flexible element`,
        );
      }
    }
  }
}
