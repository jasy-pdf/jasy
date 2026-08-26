import MyModule from "../../../src/module";

export default defineNuxtConfig({
  modules: [MyModule],
  jasy: { autoImport: false },
});
