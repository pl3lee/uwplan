// Runs only in the disposable E2E network. No forwarding to real providers.
import { createServer as createHTTPServer } from "node:http";
import { createServer as createHTTPSServer } from "node:https";
import { readFileSync } from "node:fs";
import { startOAuthFixture } from "./oauth-server.mjs";

const fixture = await startOAuthFixture({ host: "0.0.0.0", port: 8081 });
const destinations = new Map([
  ["oauth2.googleapis.com/token", "/google/token"],
  ["www.googleapis.com/oauth2/v3/certs", "/google/jwks"],
  ["github.com/login/oauth/access_token", "/github/token"],
  ["api.github.com/user", "/github/user"],
  ["api.github.com/user/emails", "/github/emails"],
]);
const hosts = new Set([...destinations.keys()].map((key) => key.split("/")[0]));
const tls = createHTTPSServer(
  {
    key: readFileSync("/certs/provider.key"),
    cert: readFileSync("/certs/provider.crt"),
    requestTimeout: 10_000,
    headersTimeout: 5_000,
  },
  async (req, res) => {
    const destination = destinations.get(`${req.headers.host}${req.url}`);
    if (!destination) {
      res.writeHead(403).end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const response = await fetch(`${fixture.origin}${destination}`, {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] ?? "application/json",
          ...(req.headers.authorization
            ? { authorization: req.headers.authorization }
            : {}),
        },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    } catch {
      res.writeHead(502).end();
    }
  },
);
const proxy = createHTTPServer((req, res) => res.writeHead(403).end());
proxy.on("connect", (req, socket, head) => {
  if (!hosts.has(req.url?.replace(/:443$/, "")) || !req.url?.endsWith(":443")) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  socket.on("error", () => {});
  socket.setTimeout(15_000, () => socket.destroy());
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head.length) socket.unshift(head);
  tls.emit("connection", socket);
});
await new Promise((resolve) => proxy.listen(8080, "0.0.0.0", resolve));
