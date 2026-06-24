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
    // Ensure flexible elements have valid flex values
    if (element.getFlex() <= 0) {
      throw new Error(`Flexible element ${element.constructor.name} has invalid flex value`);
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
