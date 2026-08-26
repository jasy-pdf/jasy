// The path that broke: the route builds elements, but definePdfHandler - OUR runtime - does the render.
// That split is where the two module records met, so this is the route worth having in a test.
export default definePdfHandler(() => Document([Page([Text("HELLO FROM THE HANDLER")])]), {
  renderOptions: { compress: false },
});
