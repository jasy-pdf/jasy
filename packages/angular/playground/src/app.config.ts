import { provideHttpClient } from "@angular/common/http";
import { provideZonelessChangeDetection, type ApplicationConfig } from "@angular/core";
import { provideJasy } from "@jasy/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(),
    // Every document can now write `Text("...", { font: "GreatVibes" })`. The file is fetched once,
    // the first time a PDF needs it.
    provideJasy({ fonts: { GreatVibes: "GreatVibes-Regular.ttf" } }),
  ],
};
