import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { TextFieldElement } from "../elements/forms/text-field-element.ts";
import { CheckboxElement } from "../elements/forms/checkbox-element.ts";
import { RadioElement } from "../elements/forms/radio-element.ts";
import { ChoiceElement } from "../elements/forms/choice-element.ts";
import { IRNode } from "../ir/display-list.ts";

/** Any form-field element exposes its box + shared spec + style through `getProps()`. */
type FormFieldElement = TextFieldElement | CheckboxElement | RadioElement | ChoiceElement;

/**
 * Renders a form-field element to a single `formfield` IR node - the field's box + its shared
 * `FormFieldSpec` + style. It draws nothing; the PageRenderer peels it into a Widget /Annot and the
 * /AcroForm (via forms/acroform.ts). One renderer serves every field element (the spec's `kind`
 * discriminates downstream).
 */
export class FormFieldRenderer {
  static async render(
    element: FormFieldElement,
    _objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { x, y, width, height, spec, style } = element.getProps();
    return [{ type: "formfield", x, y, width, height, field: spec, style }];
  }
}
