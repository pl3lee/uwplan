import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import {
  type EntryContext,
  isRouteErrorResponse,
  ServerRouter,
} from "react-router";
import { logEvent } from "../observability.mjs";

export const streamTimeout = 5000;

export function handleError(error: unknown) {
  // Expected HTTP rejections already have a correlated request log and status.
  if (isRouteErrorResponse(error) && error.status >= 400 && error.status < 500)
    return;
  logEvent("error", "render.failed", {
    error_type: error instanceof Error ? error.name : "unknown",
  });
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  context: EntryContext,
) {
  return new Promise<Response>((resolve, reject) => {
    const ready =
      isbot(request.headers.get("user-agent") ?? "") || context.isSpaMode
        ? "onAllReady"
        : "onShellReady";
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={context} url={request.url} />,
      {
        [ready]() {
          const body = new PassThrough();
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          responseHeaders.set("Cache-Control", "no-store");
          resolve(
            new Response(createReadableStreamFromReadable(body), {
              status: responseStatusCode,
              headers: responseHeaders,
            }),
          );
          pipe(body);
        },
        onShellError: reject,
        onError(error) {
          responseStatusCode = 500;
          handleError(error);
        },
      },
    );
    setTimeout(abort, streamTimeout + 1000).unref();
  });
}
