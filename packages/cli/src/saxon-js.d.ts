// SaxonJS ships no type definitions; this is the slim slice we use (synchronous XSLT transform).
declare module "saxon-js" {
  interface TransformOptions {
    stylesheetText?: string;
    stylesheetFileName?: string;
    sourceText?: string;
    destination?: "serialized" | "document" | "application";
  }
  interface TransformResult {
    principalResult?: string;
  }
  const SaxonJS: {
    transform(options: TransformOptions, mode?: "sync" | "async"): TransformResult;
  };
  export default SaxonJS;
}
