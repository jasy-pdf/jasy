// `#imports` resolves inside a NITRO server build, where Nitro contributes its own utils. Type-checking
// this module's source in isolation only sees Nuxt's `#imports`, which does not carry them - so the one
// util we use is declared here rather than suppressed. Runtime is unaffected: the real implementation is
// whatever Nitro injects.
declare module "#imports" {
  export function defineCachedFunction<T extends (...args: never[]) => Promise<unknown>>(
    fn: T,
    opts?: Record<string, unknown>,
  ): T;
}
