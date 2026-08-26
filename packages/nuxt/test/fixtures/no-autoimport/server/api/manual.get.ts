// autoImport off: the user imports the element API themselves. definePdfHandler stays available (it is
// registered outside the option), and it must still render with the SAME @jasy/pdf the imports above
// resolve to - that is the whole point of taking renderToBytes from #imports.
import { Document, Page, Text } from "@jasy/pdf";

export default definePdfHandler(() => Document([Page([Text("MANUAL IMPORTS ONLY")])]), {
  renderOptions: { compress: false },
});
