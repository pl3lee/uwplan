import { fileURLToPath } from "node:url";
import express from "express";
import {
  logEvent,
  requestTelemetry,
  setupObservability,
} from "./observability.mjs";

const log = ({ event, ...fields }) =>
  logEvent(event.endsWith(".failed") ? "error" : "info", event, fields);
let shutdownTelemetry = async () => {};

async function main() {
  process.env.NODE_ENV = "production";
  shutdownTelemetry = setupObservability();
  // Load React only after selecting production mode so the renderer and router
  // use the same runtime even when NODE_ENV was absent in the launch environment.
  const { createRequestHandler } = await import("@react-router/express");
  if (!process.env.API_ORIGIN) throw new Error("API_ORIGIN is required");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  const build = await import("./build/server/index.js");
  const app = express();
  app.disable("x-powered-by");
  app.use(requestTelemetry);
  const client = fileURLToPath(new URL("./build/client/", import.meta.url));
  app.use(
    "/assets",
    express.static(`${client}/assets`, { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static(client, { maxAge: "1h" }));
  app.use(createRequestHandler({ build, mode: "production" }));
  app.use((error, _req, res, _next) => {
    log({
      event: "http.failed",
      error_type: error instanceof Error ? error.name : "unknown",
    });
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res
      .status(500)
      .set("Cache-Control", "no-store")
      .json({ title: "Internal Server Error", status: 500 });
  });
  const server = app.listen(port, process.env.HOST ?? "0.0.0.0", () =>
    log({ event: "server.started", port }),
  );
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.on("error", async (error) => {
    log({ event: "server.failed", error_type: error.name });
    process.exitCode = 1;
    await shutdownTelemetry();
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close(async () => {
        await shutdownTelemetry();
        process.exitCode = 0;
      });
      setTimeout(() => server.closeAllConnections(), 10_000).unref();
    });
}

main().catch(async (error) => {
  log({
    event: "startup.failed",
    error_type: error instanceof Error ? error.name : "unknown",
  });
  process.exitCode = 1;
  await shutdownTelemetry();
});
