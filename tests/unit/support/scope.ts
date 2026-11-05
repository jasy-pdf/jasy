import type { RenderScope } from "../../../src/lib/utils/renderer-registry.ts";

/** Render at the page's top-left, with the page corner as the positioning frame. */
export const PAGE_SCOPE: RenderScope = { origin: { x: 0, y: 0 }, frame: { x: 0, y: 0 } };
