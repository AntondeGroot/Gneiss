import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";
import { appConfig } from "./app/app.config";

bootstrapApplication(App, appConfig).catch((err: unknown) =>
  // The only failure with nowhere better to go: if bootstrap itself fails there
  // is no app, and so no logger or error UI, to report it through.
  // eslint-disable-next-line no-console
  console.error(err),
);
