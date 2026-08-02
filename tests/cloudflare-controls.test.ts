/** @jest-environment node */

import { createHash, webcrypto } from "node:crypto";

import {
  CloudflareApi,
  assertNonProductionZone,
  assertWorkerCapacity,
  captureOriginRecords,
  switchOriginRecords,
  verifyOriginTls,
  verifyShortLivedToken,
} from "../ops/cloudflare/control.mjs";
import {
  OperatorBypassCoordinator,
  createMaintenanceWorker,
} from "../ops/cloudflare/worker.mjs";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

class FakeStorage {
  values = new Map<string, unknown>();

  async get(key: string) {
    return this.values.get(key);
  }

  async put(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys])
      this.values.delete(key);
  }

  async list({ prefix }: { prefix: string }) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)));
  }

  async transaction<T>(callback: (storage: FakeStorage) => Promise<T>) {
    return await callback(this);
  }
}

function workerHarness(
  options: { originFailure?: boolean; coordinatorFailure?: boolean } = {},
) {
  const storage = new FakeStorage();
  const coordinator = new OperatorBypassCoordinator({ storage });
  const originRequests: Request[] = [];
  const fetchImpl = async (request: Request) => {
    originRequests.push(request);
    if (options.originFailure) throw new Error("origin unavailable");
    if (new URL(request.url).pathname === "/api/ready") {
      return Response.json({
        status: "ready",
        release: { digest: `sha256:${"a".repeat(64)}`, revision: "test" },
        dependencies: { database: "available", secretDetail: "must-not-pass" },
      });
    }
    return new Response("origin response");
  };
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init: RequestInit) => {
        if (options.coordinatorFailure) throw new Error("quota exceeded");
        return await coordinator.fetch(new Request(url, init));
      },
    }),
  };
  const bootstrap = "b".repeat(48);
  const control = "c".repeat(48);
  const env = {
    ALLOWED_HOSTS: "test.example.net,www.test.example.net",
    BOOTSTRAP_GENERATION: "generation-1",
    BOOTSTRAP_TOKEN_SHA256: sha256(bootstrap),
    CONTROL_TOKEN_SHA256: sha256(control),
    BYPASS_COORDINATOR: namespace,
  };
  return {
    bootstrap,
    control,
    env,
    originRequests,
    worker: createMaintenanceWorker({ fetchImpl }),
  };
}

describe("fail-closed maintenance Worker", () => {
  it("returns no-store 503 maintenance for normal and OAuth requests without contacting origin", async () => {
    const harness = workerHarness();
    for (const path of [
      "/",
      "/api/auth/signin/github",
      "/api/auth/callback/google",
    ]) {
      const response = await harness.worker.fetch(
        new Request(`https://test.example.net${path}`),
        harness.env,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("300");
    }
    expect(harness.originRequests).toHaveLength(0);
  });

  it("passes only sanitized readiness without an operator session", async () => {
    const harness = workerHarness();
    const response = await harness.worker.fetch(
      new Request("https://test.example.net/api/ready", {
        headers: {
          authorization: "Bearer should-not-reach-origin",
          cookie: "__Host-uwplan-operator=fake; app-session=keep",
        },
      }),
      harness.env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      release: { digest: `sha256:${"a".repeat(64)}`, revision: "test" },
    });
    expect(harness.originRequests).toHaveLength(1);
    expect(harness.originRequests[0]?.headers.get("authorization")).toBeNull();
    expect(harness.originRequests[0]?.headers.get("cookie")).toBe(
      "app-session=keep",
    );
  });

  it("consumes a bootstrap once, creates a 30-minute host-only cookie, strips it upstream, and revokes it", async () => {
    const harness = workerHarness();
    const bootstrapRequest = () =>
      new Request("https://test.example.net/__uwplan/operator/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${harness.bootstrap}` },
      });
    const created = await harness.worker.fetch(bootstrapRequest(), harness.env);
    expect(created.status).toBe(303);
    const setCookie = created.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-uwplan-operator=");
    expect(setCookie).toContain("Max-Age=1800");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Domain=");
    expect(
      (await harness.worker.fetch(bootstrapRequest(), harness.env)).status,
    ).toBe(503);

    const cookie = setCookie.split(";")[0] as string;
    const admitted = await harness.worker.fetch(
      new Request("https://test.example.net/private", {
        headers: { cookie: `${cookie}; app-session=keep` },
      }),
      harness.env,
    );
    expect(admitted.status).toBe(200);
    expect(await admitted.text()).toBe("origin response");
    expect(harness.originRequests.at(-1)?.headers.get("cookie")).toBe(
      "app-session=keep",
    );

    const revoked = await harness.worker.fetch(
      new Request("https://test.example.net/__uwplan/operator/revoke", {
        method: "POST",
        headers: { authorization: `Bearer ${harness.control}` },
      }),
      harness.env,
    );
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (
        await harness.worker.fetch(
          new Request("https://test.example.net/private", {
            headers: { cookie },
          }),
          harness.env,
        )
      ).status,
    ).toBe(503);
  });

  it("rotates generations by invalidating the old session and consuming a new bootstrap", async () => {
    const harness = workerHarness();
    const first = await harness.worker.fetch(
      new Request("https://test.example.net/__uwplan/operator/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${harness.bootstrap}` },
      }),
      harness.env,
    );
    const firstSetCookie = first.headers.get("set-cookie");
    if (!firstSetCookie) throw new Error("bootstrap response omitted cookie");
    const firstCookie = firstSetCookie.split(";")[0];
    if (!firstCookie) throw new Error("bootstrap response cookie is empty");

    const rotatedBootstrap = "d".repeat(48);
    harness.env.BOOTSTRAP_GENERATION = "generation-2";
    harness.env.BOOTSTRAP_TOKEN_SHA256 = sha256(rotatedBootstrap);
    expect(
      (
        await harness.worker.fetch(
          new Request("https://test.example.net/private", {
            headers: { cookie: firstCookie },
          }),
          harness.env,
        )
      ).status,
    ).toBe(503);

    const second = await harness.worker.fetch(
      new Request("https://test.example.net/__uwplan/operator/bootstrap", {
        method: "POST",
        headers: { authorization: `Bearer ${rotatedBootstrap}` },
      }),
      harness.env,
    );
    expect(second.status).toBe(303);
    expect(second.headers.get("set-cookie")).toContain(
      "__Host-uwplan-operator=",
    );
  });

  it("fails closed on coordinator quota errors, bad credentials, wrong hosts, and origin errors", async () => {
    const quota = workerHarness({ coordinatorFailure: true });
    expect(
      (
        await quota.worker.fetch(
          new Request("https://test.example.net/private", {
            headers: { cookie: "__Host-uwplan-operator=x".repeat(48) },
          }),
          quota.env,
        )
      ).status,
    ).toBe(503);
    expect(quota.originRequests).toHaveLength(0);

    const origin = workerHarness({ originFailure: true });
    expect(
      (
        await origin.worker.fetch(
          new Request("https://test.example.net/api/ready"),
          origin.env,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await origin.worker.fetch(
          new Request("https://uwplan.com/api/ready"),
          origin.env,
        )
      ).status,
    ).toBe(503);
  });
});

interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  comment: string;
  tags: string[];
  settings: Record<string, unknown>;
}

function fakeApi() {
  const records = new Map<string, DnsRecord>([
    [
      "apex-id",
      {
        id: "apex-id",
        name: "test.example.net",
        type: "A",
        content: "192.0.2.10",
        proxied: true,
        ttl: 1,
        comment: "keep",
        tags: ["owner:uwplan"],
        settings: { ipv4_only: true },
      },
    ],
    [
      "www-id",
      {
        id: "www-id",
        name: "www.test.example.net",
        type: "CNAME",
        content: "old.test.example.net",
        proxied: true,
        ttl: 1,
        comment: "keep-www",
        tags: [],
        settings: {},
      },
    ],
  ]);
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    records,
    patches,
    getZone: async () => ({ id: "zone-id", name: "test.example.net" }),
    listDnsRecords: async (_zoneId: string, hostname: string) =>
      [...records.values()]
        .filter((record) => record.name === hostname)
        .map((record) => ({ ...record })),
    getDnsRecord: async (_zoneId: string, id: string) =>
      ({ ...records.get(id) }) as DnsRecord,
    patchDnsRecord: async (
      _zoneId: string,
      id: string,
      patch: { content: string },
    ) => {
      patches.push({ id, patch });
      const current = records.get(id) as DnsRecord;
      records.set(id, { ...current, ...patch });
      return { ...records.get(id) };
    },
    getSslMode: async () => ({ value: "strict" }),
  };
}

describe("reversible Cloudflare controls", () => {
  it("uses Bearer authentication without leaking a token through API errors", async () => {
    const token = "sentinel-cloudflare-token-must-not-leak";
    const requests: Array<{
      url: string;
      authorization: string | null;
      body: string | undefined;
    }> = [];
    const fetchImpl = jest.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
          body: init?.body as string | undefined,
        });
        if (String(input).endsWith("/user/tokens/verify")) {
          return Response.json({
            success: true,
            result: {
              id: "token-id",
              status: "active",
              expires_on: "2026-08-02T21:00:00Z",
              not_before: "2026-08-02T20:00:00Z",
            },
          });
        }
        return Response.json(
          { success: false, errors: [{ code: 10000, message: token }] },
          { status: 403 },
        );
      },
    );
    const api = new CloudflareApi({ token, fetchImpl });
    await expect(api.verifyToken()).resolves.toEqual(
      expect.objectContaining({ id: "token-id", status: "active" }),
    );
    await expect(api.getZone("zone-id")).rejects.toThrow(
      "Cloudflare API request failed (403; codes: 10000)",
    );
    await expect(api.getZone("zone-id")).rejects.not.toThrow(token);
    expect(requests[0]?.authorization).toBe(`Bearer ${token}`);
  });

  it("captures exact records and changes only origin values in both idempotent directions", async () => {
    const api = fakeApi();
    const initialRecords = structuredClone([...api.records.values()]);
    const snapshot = await captureOriginRecords({
      api,
      zoneId: "zone-id",
      zoneName: "test.example.net",
      hostnames: ["test.example.net", "www.test.example.net"],
    });
    const readiness = jest.fn(async () => ({ ready: true, status: 200 }));
    const digitalOcean = {
      "test.example.net": "198.51.100.20",
      "www.test.example.net": "new.test.example.net",
    };
    const forward = await switchOriginRecords({
      api,
      snapshot,
      targetByHostname: digitalOcean,
      verifyReadiness: readiness,
    });
    expect(forward).toEqual(
      expect.objectContaining({
        idempotent: false,
        changed: ["test.example.net", "www.test.example.net"],
      }),
    );
    expect(api.patches.map(({ patch }) => patch)).toEqual([
      { content: "198.51.100.20" },
      { content: "new.test.example.net" },
    ]);
    expect(
      await switchOriginRecords({
        api,
        snapshot,
        targetByHostname: digitalOcean,
        verifyReadiness: readiness,
      }),
    ).toEqual(expect.objectContaining({ idempotent: true, changed: [] }));
    const reverseTargets = Object.fromEntries(
      snapshot.records.map((record) => [record.name, record.content]),
    );
    await switchOriginRecords({
      api,
      snapshot,
      targetByHostname: reverseTargets,
      verifyReadiness: readiness,
    });
    expect([...api.records.values()]).toEqual(initialRecords);
    expect(readiness).toHaveBeenCalledTimes(3);
  });

  it("fails before mutation on record drift and fails promotion when readiness is unhealthy", async () => {
    const api = fakeApi();
    const snapshot = await captureOriginRecords({
      api,
      zoneId: "zone-id",
      zoneName: "test.example.net",
      hostnames: ["test.example.net", "www.test.example.net"],
    });
    (api.records.get("apex-id") as DnsRecord).proxied = false;
    await expect(
      switchOriginRecords({
        api,
        snapshot,
        targetByHostname: {
          "test.example.net": "198.51.100.20",
          "www.test.example.net": "new.test.example.net",
        },
        verifyReadiness: async () => ({ ready: true }),
      }),
    ).rejects.toThrow("unrelated fields drifted");
    expect(api.patches).toHaveLength(0);

    (api.records.get("apex-id") as DnsRecord).proxied = true;
    (api.records.get("www-id") as DnsRecord).comment = "drifted";
    await expect(
      switchOriginRecords({
        api,
        snapshot,
        targetByHostname: {
          "test.example.net": "198.51.100.20",
          "www.test.example.net": "new.test.example.net",
        },
        verifyReadiness: async () => ({ ready: true }),
      }),
    ).rejects.toThrow("unrelated fields drifted");
    expect(api.patches).toHaveLength(0);

    (api.records.get("www-id") as DnsRecord).comment = "keep-www";
    await expect(
      switchOriginRecords({
        api,
        snapshot,
        targetByHostname: {
          "test.example.net": "198.51.100.20",
          "www.test.example.net": "new.test.example.net",
        },
        verifyReadiness: async () => ({ ready: false }),
      }),
    ).rejects.toThrow("failed live readiness");
  });

  it("requires Full strict and an active Cloudflare Origin CA certificate for apex and www", async () => {
    const api = fakeApi();
    const result = await verifyOriginTls({
      api,
      zoneId: "zone-id",
      hostnames: ["test.example.net", "www.test.example.net"],
      probe: async () => ({
        issuer: "Cloudflare Origin SSL Certificate Authority",
        subjectAltNames: ["test.example.net", "www.test.example.net"],
        validNow: true,
        protocol: "TLSv1.3",
        fingerprint256: "AA:BB",
      }),
    });
    expect(result.mode).toBe("strict");
    expect(result.certificates).toHaveLength(2);

    api.getSslMode = async () => ({ value: "full" });
    await expect(
      verifyOriginTls({
        api,
        zoneId: "zone-id",
        hostnames: ["test.example.net"],
        probe: async () => ({}),
      }),
    ).rejects.toThrow("Full (strict)");
  });

  it("enforces a non-production zone and a reserved free-tier capacity boundary", () => {
    expect(assertNonProductionZone("migration-test.example.net")).toBe(
      "migration-test.example.net",
    );
    expect(() => assertNonProductionZone("uwplan.com")).toThrow("refuses");
    expect(() => assertNonProductionZone("preview.uwplan.com")).toThrow(
      "refuses",
    );
    expect(
      assertWorkerCapacity({ used: 90_000, limit: 100_000, reserved: 1_000 }),
    ).toEqual(expect.objectContaining({ remainingAfterReservation: 9_000 }));
    expect(() =>
      assertWorkerCapacity({ used: 99_500, limit: 100_000, reserved: 1_000 }),
    ).toThrow("capacity");
    const now = Date.parse("2026-08-02T20:00:00Z");
    expect(
      verifyShortLivedToken(
        {
          id: "token-id",
          status: "active",
          notBefore: "2026-08-02T19:59:00Z",
          expiresOn: "2026-08-02T21:00:00Z",
        },
        { now },
      ),
    ).toEqual({ id: "token-id", expiresAt: "2026-08-02T21:00:00.000Z" });
    expect(() =>
      verifyShortLivedToken(
        { status: "active", expiresOn: "2026-08-03T00:00:00Z" },
        { now },
      ),
    ).toThrow("expire within two hours");
  });
});
