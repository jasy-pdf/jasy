import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { TextFieldElement } from "../elements/forms/text-field-element.ts";
import { CheckboxElement } from "../elements/forms/checkbox-element.ts";
import { RadioElement } from "../elements/forms/radio-element.ts";
import { ChoiceElement } from "../elements/forms/choice-element.ts";
import { PushButtonElement } from "../elements/forms/push-button-element.ts";
import { SignatureFieldElement } from "../elements/forms/signature-element.ts";
import { IRNode } from "../ir/display-list.ts";

/** Any form-field element exposes its box + shared spec + style through `getProps()`. */
type FormFieldElement =
  | TextFieldElement
  | CheckboxElement
  | RadioElement
  | ChoiceElement
  | PushButtonElement
  | SignatureFieldElement;

/**
 * Renders a form-field element to a single `formfield` IR node - the field's box + its shared
 * `FormFieldSpec` + style. It draws nothing; the PageRenderer peels it into a Widget /Annot and the
 * /AcroForm (via forms/acroform.ts). One renderer serves every field element (the spec's `kind`
 * discriminates downstream).
 */
export class FormFieldRenderer {
  static async render(
    element: FormFieldElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x: ownX, y: ownY, width, height, spec, style } = element.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);
    // Tagged: the widget goes into a /Form element, named by its tooltip (/TU) or else its field name
    // (PDF/UA 7.18.1, 7.18.4). A radio button is one answer of its group.
    const name = spec.kind === "radio" ? `${spec.group}: ${spec.value}` : spec.name;
    const structKey = objectManager.struct.enabled
      ? objectManager.struct.openElement(element.structId, "Form", {
          alt: spec.tooltip === undefined ? name : undefined,
        })
      : undefined;
    return [{ type: "formfield", x, y, width, height, field: spec, style, structKey }];
  }
}
