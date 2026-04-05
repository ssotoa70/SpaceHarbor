// Accept self-signed VAST cluster certificates.
// Must be set before any fetch/TLS calls. Controlled by SPACEHARBOR_VAST_SKIP_TLS.
if (process.env.SPACEHARBOR_VAST_SKIP_TLS !== "false" && process.env.SPACEHARBOR_VAST_SKIP_TLS !== "0") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildApp();

app.listen({ port, host }).catch((error) => {
  console.error("[server] fatal startup error:", error);
  process.exit(1);
});
