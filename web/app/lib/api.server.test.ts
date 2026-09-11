import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { proxyApiRequest } from "./api.server";

beforeEach(() => vi.stubEnv("API_ORIGIN", "http://api.internal:8080"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("forwards only application cookies and preserves the browser's Origin", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const request = new Request("https://uwplan.com/api/v1/auth/logout", {
    method: "POST",
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      Cookie: "tracking=private; __Host-uwplan_session=session-token",
      Origin: "https://evil.example",
      Authorization: "Bearer unrelated-secret",
    },
  });
  const response = await proxyApiRequest(request);
  expect(response.status).toBe(204);
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("http://api.internal:8080/api/v1/auth/logout");
  expect(options.method).toBe("POST");
  expect(options.redirect).toBe("manual");
  expect(options.headers.get("Cookie")).toBe(
    "__Host-uwplan_session=session-token",
  );
  expect(options.headers.get("Origin")).toBe("https://evil.example");
  expect(options.headers.get("Authorization")).toBeNull();
});

it("preserves separate callback cookies and redirects", async () => {
  const headers = new Headers({ Location: "/select" });
  headers.append(
    "Set-Cookie",
    "__Host-uwplan_oauth_google=; Path=/; Max-Age=0; Secure; HttpOnly",
  );
  headers.append(
    "Set-Cookie",
    "__Host-uwplan_session=new-session; Path=/; Secure; HttpOnly",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 302, headers })),
  );
  const response = await proxyApiRequest(
    new Request(
      "https://uwplan.com/api/auth/callback/google?code=fixture&state=fixture",
    ),
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/select");
  expect(response.headers.getSetCookie()).toEqual(headers.getSetCookie());
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("rejects oversized bodies before contacting the API", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const response = await proxyApiRequest(
    new Request("https://uwplan.com/api/v1/templates", {
      method: "POST",
      body: "x".repeat(1024 * 1024 + 1),
    }),
  );
  expect(response.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

it("returns a generic gateway error when the upstream fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("credential-sentinel")),
  );
  const response = await proxyApiRequest(
    new Request("https://uwplan.com/api/v1/me"),
  );
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    title: "Bad Gateway",
    status: 502,
    detail: "API unavailable",
  });
});
