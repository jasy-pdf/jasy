// `svg-parser` ships no types. It returns a hast-like tree: elements with a `tagName`, a flat
// `properties` bag of the raw attribute strings, and children. Text (the content of a `<style>` or
// `<title>`) arrives as its own node kind.
declare module "svg-parser" {
  export interface SvgTextNode {
    type: "text";
    value: string | number;
  }

  export interface SvgElementNode {
    type: "element";
    tagName?: string;
    properties?: Record<string, string | number | undefined>;
    children?: SvgAstNode[];
  }

  export interface SvgRootNode {
    type: "root";
    children?: SvgAstNode[];
  }

  export type SvgAstNode = SvgElementNode | SvgTextNode | SvgRootNode;

  export function parse(source: string): SvgRootNode;
}
