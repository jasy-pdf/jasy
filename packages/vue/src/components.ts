import { defineComponent, h } from "vue";

/**
 * A host component: renders the engine host tag (`document`/`page`/`text`/…, which the descriptor seam
 * knows) while exposing a conflict-free, brand-prefixed name (`JasyText` does not clash with the DOM
 * `Text`, `JasyImage` not with `Image`, etc.). Every prop is forwarded via attrs and the default slot
 * becomes the children. So `<JasyBox :bg="'#eef'" :padding="12">` lands as a `box` descriptor with
 * `{ bg, padding }`. (Boolean shorthands like `<JasyText bold>` should be `:bold="true"` for now -
 * typed props per component come next.)
 */
function host(tag: string, name: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      return () => h(tag, { ...attrs }, slots.default?.());
    },
  });
}

export const JasyDocument = host("document", "JasyDocument");
export const JasyPage = host("page", "JasyPage");
export const JasyColumn = host("column", "JasyColumn");
export const JasyRow = host("row", "JasyRow");
export const JasyBox = host("box", "JasyBox");
export const JasyPadding = host("padding", "JasyPadding");
export const JasyExpanded = host("expanded", "JasyExpanded");
export const JasySpacer = host("spacer", "JasySpacer");
export const JasyDivider = host("divider", "JasyDivider");
export const JasyImage = host("image", "JasyImage");
export const JasyText = host("text", "JasyText");
export const JasyParagraph = host("paragraph", "JasyParagraph");
/** `<JasySpan>` inside a `<JasyText>` for mixed inline styling (font / size / color per run). */
export const JasySpan = host("span", "JasySpan");
