const COOKIE_NAME = "__Host-uwplan-operator";
const COOKIE_MAX_AGE_SECONDS = 30 * 60;
const MAINTENANCE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "retry-after": "300",
});

function maintenanceResponse() {
  return new Response(
    "<!doctype html><title>UWPlan maintenance</title><h1>UWPlan is temporarily unavailable</h1>",
    { status: 503, headers: MAINTENANCE_HEADERS },
  );
}

function isAllowedHost(hostname, env) {
  const configured = String(env.ALLOWED_HOSTS ?? "uwplan.com,www.uwplan.com")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(hostname.toLowerCase());
}

function bytesToHex(bytes) {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (left.charCodeAt(index % Math.max(left.length, 1)) || 0) ^
      (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43,})$/.exec(header);
  return match?.[1] ?? null;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function cookieToken(request) {
  const header = request.headers.get("cookie") ?? "";
  for (const fragment of header.split(";")) {
    const [name, ...value] = fragment.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

function stripBypassCookie(headers) {
  const result = new Headers(headers);
  result.delete("authorization");
  const cookie = result.get("cookie");
  if (!cookie) return result;
  const retained = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(`${COOKIE_NAME}=`));
  if (retained.length === 0) result.delete("cookie");
  else result.set("cookie", retained.join("; "));
  return result;
}

function coordinator(env) {
  if (!env.BYPASS_COORDINATOR?.idFromName) {
    throw new Error("operator bypass coordinator is unavailable");
  }
  return env.BYPASS_COORDINATOR.get(
    env.BYPASS_COORDINATOR.idFromName("uwplan-operator-bypass"),
  );
}

async function callCoordinator(env, action, body) {
  return coordinator(env).fetch(`https://coordinator.invalid/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Secure; HttpOnly; SameSite=Lax`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

async function bootstrap(request, env) {
  if (request.method !== "POST") return maintenanceResponse();
  const token = bearerToken(request);
  if (!token || !env.BOOTSTRAP_TOKEN_SHA256 || !env.BOOTSTRAP_GENERATION) {
    return maintenanceResponse();
  }
  const digest = await sha256(token);
  if (!constantTimeEqual(digest, env.BOOTSTRAP_TOKEN_SHA256)) {
    return maintenanceResponse();
  }
  const session = randomToken();
  const result = await callCoordinator(env, "consume", {
    generation: env.BOOTSTRAP_GENERATION,
    sessionDigest: await sha256(session),
    expiresAt: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000,
  });
  if (!result.ok) return maintenanceResponse();
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: "/",
      "set-cookie": setCookie(session),
    },
  });
}

async function revoke(request, env) {
  if (request.method !== "POST") return maintenanceResponse();
  const token = bearerToken(request);
  if (!token || !env.CONTROL_TOKEN_SHA256) return maintenanceResponse();
  if (!constantTimeEqual(await sha256(token), env.CONTROL_TOKEN_SHA256)) {
    return maintenanceResponse();
  }
  const result = await callCoordinator(env, "revoke", {});
  if (!result.ok) return maintenanceResponse();
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store", "set-cookie": clearCookie() },
  });
}

async function hasBypass(request, env) {
  const token = cookieToken(request);
  if (!token || token.length < 43 || !env.BOOTSTRAP_GENERATION) return false;
  const result = await callCoordinator(env, "validate", {
    generation: env.BOOTSTRAP_GENERATION,
    sessionDigest: await sha256(token),
    now: Date.now(),
  });
  return result.ok;
}

async function proxy(request, fetchImpl, { readiness = false } = {}) {
  const upstream = new Request(request, {
    headers: stripBypassCookie(request.headers),
  });
  const response = await fetchImpl(upstream);
  if (!readiness) {
    const guarded = new Response(response.body, response);
    guarded.headers.set("cache-control", "no-store");
    return guarded;
  }
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  try {
    const body = await response.json();
    const sanitized = {
      status: body?.status === "ready" ? "ready" : "unready",
      release:
        typeof body?.release?.digest === "string" &&
        typeof body?.release?.revision === "string"
          ? {
              digest: body.release.digest,
              revision: body.release.revision,
            }
          : undefined,
    };
    return new Response(JSON.stringify(sanitized), {
      status: response.ok && sanitized.status === "ready" ? 200 : 503,
      headers,
    });
  } catch {
    return maintenanceResponse();
  }
}

export function createMaintenanceWorker({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        if (!isAllowedHost(url.hostname, env)) return maintenanceResponse();
        if (url.pathname === "/__uwplan/operator/bootstrap") {
          return await bootstrap(request, env);
        }
        if (url.pathname === "/__uwplan/operator/revoke") {
          return await revoke(request, env);
        }
        if (url.pathname === "/api/ready") {
          return await proxy(request, fetchImpl, { readiness: true });
        }
        if (await hasBypass(request, env)) {
          return await proxy(request, fetchImpl);
        }
        return maintenanceResponse();
      } catch {
        // Missing bindings, Durable Object/Workers quota failures, and origin
        // errors must never create an unguarded path to origin.
        return maintenanceResponse();
      }
    },
  };
}

export class OperatorBypassCoordinator {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    const body = await request.json();
    if (action === "consume") {
      return await this.state.storage.transaction(async (transaction) => {
        const consumedKey = `consumed:${body.generation}`;
        if (await transaction.get(consumedKey)) {
          return new Response(null, { status: 409 });
        }
        const sessions = await transaction.list({ prefix: "session:" });
        if (sessions.size > 0) await transaction.delete([...sessions.keys()]);
        await transaction.put(consumedKey, true);
        await transaction.put(`session:${body.sessionDigest}`, {
          generation: body.generation,
          expiresAt: body.expiresAt,
        });
        return new Response(null, { status: 204 });
      });
    }
    if (action === "validate") {
      const session = await this.state.storage.get(
        `session:${body.sessionDigest}`,
      );
      const valid =
        session?.generation === body.generation &&
        Number(session?.expiresAt) > Number(body.now);
      if (!valid && session) {
        await this.state.storage.delete(`session:${body.sessionDigest}`);
      }
      return new Response(null, { status: valid ? 204 : 401 });
    }
    if (action === "revoke") {
      const sessions = await this.state.storage.list({ prefix: "session:" });
      if (sessions.size > 0)
        await this.state.storage.delete([...sessions.keys()]);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }
}

export default createMaintenanceWorker();
