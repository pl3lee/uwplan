import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api-fetch";

afterEach(() => vi.unstubAllGlobals());
describe("generated API transport", () => {
  it("includes same-origin cookies and decodes successful JSON", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('{"id":"legacy-user"}', {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await apiFetch<{ data: unknown; status: number }>(
      "/api/v1/me",
    );
    expect(response.data).toEqual({ id: "legacy-user" });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/me",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
  it("rejects authorization failures instead of caching them as successful data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"detail":"Unauthorized"}', {
          status: 401,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    );
    await expect(apiFetch("/api/v1/me")).rejects.toEqual(
      new ApiError(401, { detail: "Unauthorized" }),
    );
  });
  it("accepts empty mutation responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(
      apiFetch("/api/v1/auth/logout", { method: "POST" }),
    ).resolves.toMatchObject({ status: 204, data: undefined });
  });
  it("preserves CSV downloads as blobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Selected Courses:\n", {
          headers: { "Content-Type": "text/csv" },
        }),
      ),
    );
    const response = await apiFetch<{ data: Blob }>(
      "/api/v1/schedules/fixture/export",
    );
    expect(await response.data.text()).toBe("Selected Courses:\n");
  });
});
