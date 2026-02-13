import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

const app = buildApp();

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
