// Fault injection belongs only to the disposable candidate fixture image.
import { Server } from "node:http";
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, request, response, ...args) {
  if (event === "request" && request.url.split("?")[0] === "/api/ready") {
    const writeHead = response.writeHead;
    response.writeHead = function (...headArgs) {
      this.setHeader("X-UWPlan-Web-Release-Digest", "deliberately-invalid-release");
      return writeHead.apply(this, headArgs);
    };
  }
  return emit.call(this, event, request, response, ...args);
};
