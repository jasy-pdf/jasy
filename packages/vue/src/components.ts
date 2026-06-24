import { defineComponent, h } from "vue";

/**
 * A host component: renders the engine host tag of `type`, forwarding every prop (via attrs) and the
 * default slot as children. `inheritAttrs: false` because we forward attrs explicitly. So `<Box :bg="
 * '#eef'" :padding="12">` lands as a `box` descriptor with `{ bg, padding }`. (Boolean shorthands like
 * `<Text bold>` should be written `:bold="true"` for now - typed props per component come next.)
 */
function host(type: string) {
  return defineComponent({
    name: type,
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      return () => h(type, { ...attrs }, slots.default?.());
    },
  });
}

export const Document = host("document");
export const Page = host("page");
export const Column = host("column");
export const Row = host("row");
export const Box = host("box");
export const Padding = host("padding");
export const Expanded = host("expanded");
export const Spacer = host("spacer");
export const Divider = host("divider");
export const Image = host("image");
export const Text = host("text");
export const Paragraph = host("paragraph");
/** `<Span>` inside a `<Text>` for mixed inline styling (font / size / color per run). */
export const Span = host("span");
