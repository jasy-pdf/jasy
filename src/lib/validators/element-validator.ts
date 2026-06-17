import { PDFDocumentElement } from "../elements/pdf-document-element";
import {
  PDFElement,
  FlexiblePDFElement,
  hasChildProp,
  SizedPDFElement,
} from "../elements/pdf-element";

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
      const { x, y, width, height } = element.getSize();
      if (x < 0 || y < 0) {
        throw new Error(
          `Element ${element.constructor.name} has invalid coordinates (x: ${x}, y: ${y})`,
        );
      }
      if ((width !== undefined && width <= 0) || (height !== undefined && height <= 0)) {
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
    const { x, y, width, height } = element.getSize();
    if (x < 0 || y < 0) {
      throw new Error(
        `Element ${element.constructor.name} has invalid coordinates (x: ${x}, y: ${y})`,
      );
    }

    if (width === undefined || height === undefined || width <= 0 || height <= 0) {
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
