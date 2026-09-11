import type { ApiRequestOptions } from "./api-fetch";

function apiOrigin(): string {
  const value =
    process.env.API_ORIGIN ??
    (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8080");
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Invalid API_ORIGIN");
  return parsed.origin;
}

export function serverApiOptions(request: Request): ApiRequestOptions {
  // Orval merges JSON headers with object spread; use a plain record so the
  // generated mutation functions retain cookies and Origin during that merge.
  const headers: Record<string, string> = {};
  for (const name of ["Accept", "Origin", "Sec-Fetch-Site"]) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const cookies = (request.headers.get("Cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) =>
      /^(?:__Host-)?uwplan_(?:session|oauth_google|oauth_github)=/.test(part),
    );
  if (cookies.length) headers.Cookie = cookies.join("; ");
  return {
    baseUrl: apiOrigin(),
    headers,
    redirect: "manual",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
  };
}

async function boundedBody(
  request: Request,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (["GET", "HEAD"].includes(request.method) || !request.body)
    return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024 * 1024) {
        await reader.cancel();
        throw Response.json(
          {
            title: "Content Too Large",
            status: 413,
            detail: "Request body exceeds limit",
          },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function proxyApiRequest(request: Request): Promise<Response> {
  try {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith("/api/"))
      return new Response(null, { status: 404 });
    const { baseUrl, ...options } = serverApiOptions(request);
    const headers = new Headers(options.headers);
    const contentType = request.headers.get("Content-Type");
    if (contentType !== null) headers.set("Content-Type", contentType);
    const target = new URL(baseUrl ?? "");
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const response = await fetch(target.toString(), {
      ...options,
      headers,
      method: request.method,
      body: await boundedBody(request),
    });
    const responseHeaders = new Headers(response.headers);
    for (const name of [
      "connection",
      "content-length",
      "content-encoding",
      "transfer-encoding",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "upgrade",
      "set-cookie",
    ])
      responseHeaders.delete(name);
    for (const cookie of response.headers.getSetCookie())
      responseHeaders.append("Set-Cookie", cookie);
    responseHeaders.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(
      JSON.stringify({
        service: "uwplan-web",
        event: "api.proxy.failed",
        error_type: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json(
      { title: "Bad Gateway", status: 502, detail: "API unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
