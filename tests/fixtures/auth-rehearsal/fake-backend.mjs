import { createServer } from "node:http";

const port = Number(process.env.UWPLAN_FAKE_BACKEND_PORT);
if (!Number.isInteger(port) || port < 1024) process.exit(64);

createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      appMarker: "isolated-rehearsal-backend",
      path: request.url,
      authorization: request.headers.authorization ? "present" : "absent",
    }),
  );
}).listen(port, "0.0.0.0");
