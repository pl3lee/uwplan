import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "./api-fetch";
import { currentUser } from "./auth.server";

beforeEach(() => vi.stubEnv("API_ORIGIN", "http://api.internal:8080"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("renders anonymous pages without an API request when no session exists", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(
    await currentUser(new Request("https://uwplan.com/signin")),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("loads the current user through the generated client using only the session cookie", async () => {
  const user = {
    id: "legacy-user",
    name: "Student",
    email: "student@example.test",
    role: "user",
    image: null,
  };
  const fetch = vi.fn().mockResolvedValue(Response.json(user));
  vi.stubGlobal("fetch", fetch);
  expect(
    await currentUser(
      new Request("https://uwplan.com/signin", {
        headers: {
          Cookie: "tracking=private; __Host-uwplan_session=opaque-session",
        },
      }),
    ),
  ).toEqual(user);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("http://api.internal:8080/api/v1/me");
  expect(options.headers.get("Cookie")).toBe(
    "__Host-uwplan_session=opaque-session",
  );
});

it("treats an expired session as anonymous", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ status: 401 }, { status: 401 })),
  );
  expect(
    await currentUser(
      new Request("https://uwplan.com/signin", {
        headers: { Cookie: "uwplan_session=expired" },
      }),
    ),
  ).toBeNull();
});

it("preserves infrastructure failures instead of treating a user as signed out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ status: 503 }, { status: 503 })),
  );
  await expect(
    currentUser(
      new Request("https://uwplan.com/signin", {
        headers: { Cookie: "uwplan_session=valid" },
      }),
    ),
  ).rejects.toEqual(new ApiError(503, { status: 503 }));
});
