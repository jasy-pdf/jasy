// Layout tests measure without rendering, and a render is what loads the standard font metrics.
import { preloadStandardFonts } from "../src/lib/utils/afm-parser.ts";

await preloadStandardFonts();
