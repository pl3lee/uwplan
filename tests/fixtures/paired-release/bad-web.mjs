// Fault injection belongs only to the disposable candidate fixture image.
import { Server } from "node:http";
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, request, response, ...args) {
  if (event === "request" && request.url.split("?")[0] === "/api/ready") {
    fetch(`${process.env.API_ORIGIN}/api/ready`)
      .then(async (upstream) => {
        response.writeHead(upstream.status, {
          "Content-Type": "application/json",
          "X-UWPlan-Web-Release-Digest": "deliberately-invalid-release",
          "X-UWPlan-Web-Release-Revision": process.env.RELEASE_REVISION,
        });
        response.end(await upstream.text());
      })
      .catch(() => {
        response.writeHead(503);
        response.end();
      });
    return true;
  }
  return emit.call(this, event, request, response, ...args);
};
