import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app";
import { appConfig } from "./app.config";

bootstrapApplication(App, appConfig).catch((e) => console.error(e));
