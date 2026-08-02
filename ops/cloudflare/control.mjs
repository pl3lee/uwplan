import { chmod, readFile, stat, writeFile } from "node:fs/promises";

const allowedRecordTypes = new Set(["A", "AAAA", "CNAME"]);
const productionZone = "uwplan.com";

function invariantRecord(record) {
  return {
    id: record.id,
    zone_id: record.zone_id,
    zone_name: record.zone_name,
    name: record.name,
    type: record.type,
    proxiable: record.proxiable,
    proxied: record.proxied,
    ttl: record.ttl,
    meta: record.meta ?? {},
    comment: record.comment ?? null,
    tags: record.tags ?? [],
    settings: record.settings ?? {},
    created_on: record.created_on,
    comment_modified_on: record.comment_modified_on,
    tags_modified_on: record.tags_modified_on,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertNonProductionZone(zoneName) {
  const normalized = String(zoneName).toLowerCase().replace(/\.$/, "");
  if (
    normalized === productionZone ||
    normalized.endsWith(`.${productionZone}`)
  ) {
    throw new Error(
      "non-production verification refuses the UWPlan production zone",
    );
  }
  if (!normalized.includes(".")) throw new Error("zone name is invalid");
  return normalized;
}

export function assertWorkerCapacity({ used, limit, reserved = 1000 }) {
  for (const value of [used, limit, reserved]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Workers usage values must be non-negative integers");
    }
  }
  if (limit === 0 || used + reserved > limit) {
    throw new Error(
      "Workers request capacity is not safely below the applicable limit",
    );
  }
  return {
    used,
    limit,
    reserved,
    remainingAfterReservation: limit - used - reserved,
  };
}

export class CloudflareApi {
  constructor({
    token,
    fetchImpl = fetch,
    baseUrl = "https://api.cloudflare.com/client/v4",
  }) {
    if (typeof token !== "string" || token.length < 20) {
      throw new Error("Cloudflare API token is missing or too short");
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        `Cloudflare API returned a non-JSON ${response.status} response`,
      );
    }
    if (!response.ok || payload?.success !== true) {
      const codes = Array.isArray(payload?.errors)
        ? payload.errors
            .map((error) => error?.code)
            .filter(Boolean)
            .join(",")
        : "unknown";
      throw new Error(
        `Cloudflare API request failed (${response.status}; codes: ${codes})`,
      );
    }
    return payload.result;
  }

  async verifyToken(accountId) {
    const result = await this.request(
      accountId
        ? `/accounts/${encodeURIComponent(accountId)}/tokens/verify`
        : "/user/tokens/verify",
    );
    if (result?.status !== "active")
      throw new Error("Cloudflare API token is not active");
    return {
      id: result.id,
      status: result.status,
      expiresOn: result.expires_on ?? null,
      notBefore: result.not_before ?? null,
    };
  }

  async getZone(zoneId) {
    return await this.request(`/zones/${encodeURIComponent(zoneId)}`);
  }

  async listDnsRecords(zoneId, hostname) {
    const query = new URLSearchParams({ name: hostname, per_page: "100" });
    return await this.request(
      `/zones/${encodeURIComponent(zoneId)}/dns_records?${query}`,
    );
  }

  async getDnsRecord(zoneId, recordId) {
    return await this.request(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    );
  }

  async patchDnsRecord(zoneId, recordId, patch) {
    return await this.request(
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { method: "PATCH", body: patch },
    );
  }

  async getSslMode(zoneId) {
    return await this.request(
      `/zones/${encodeURIComponent(zoneId)}/settings/ssl`,
    );
  }
}

export async function captureOriginRecords({
  api,
  zoneId,
  zoneName,
  hostnames,
}) {
  const zone = await api.getZone(zoneId);
  if (String(zone?.name).toLowerCase() !== String(zoneName).toLowerCase()) {
    throw new Error("zone ID does not match the configured zone name");
  }
  const uniqueHosts = [...new Set(hostnames.map((host) => host.toLowerCase()))];
  if (uniqueHosts.length !== 2)
    throw new Error("exactly apex and www hostnames are required");
  const expectedHosts = [
    String(zoneName).toLowerCase(),
    `www.${String(zoneName).toLowerCase()}`,
  ].sort();
  if (!sameJson([...uniqueHosts].sort(), expectedHosts)) {
    throw new Error("hostnames must be the exact zone apex and www names");
  }
  const records = [];
  for (const hostname of uniqueHosts) {
    const matches = await api.listDnsRecords(zoneId, hostname);
    if (!Array.isArray(matches) || matches.length !== 1) {
      throw new Error(`expected exactly one DNS record for ${hostname}`);
    }
    const record = matches[0];
    if (!allowedRecordTypes.has(record.type) || record.proxied !== true) {
      throw new Error(`${hostname} must be a proxied A, AAAA, or CNAME record`);
    }
    records.push({ ...invariantRecord(record), content: record.content });
  }
  return {
    schemaVersion: 1,
    zoneId,
    zoneName: String(zoneName).toLowerCase(),
    capturedAt: new Date().toISOString(),
    records,
  };
}

export async function switchOriginRecords({
  api,
  snapshot,
  targetByHostname,
  verifyReadiness,
}) {
  const currentRecords = [];
  for (const baseline of snapshot.records) {
    const target = targetByHostname[baseline.name];
    if (typeof target !== "string" || target.length === 0) {
      throw new Error(`no target origin supplied for ${baseline.name}`);
    }
    const current = await api.getDnsRecord(snapshot.zoneId, baseline.id);
    if (!sameJson(invariantRecord(current), invariantRecord(baseline))) {
      throw new Error(
        `DNS record identity or unrelated fields drifted for ${baseline.name}`,
      );
    }
    currentRecords.push({ baseline, current, target });
  }
  const changed = [];
  for (const { baseline, current, target } of currentRecords) {
    if (current.content !== target) {
      await api.patchDnsRecord(snapshot.zoneId, baseline.id, {
        content: target,
      });
      changed.push(baseline.name);
    }
    const verified = await api.getDnsRecord(snapshot.zoneId, baseline.id);
    if (
      verified.content !== target ||
      !sameJson(invariantRecord(verified), invariantRecord(baseline))
    ) {
      throw new Error(`DNS record verification failed for ${baseline.name}`);
    }
  }
  const readiness = await verifyReadiness();
  if (readiness?.ready !== true)
    throw new Error("selected origin failed live readiness");
  return { changed, idempotent: changed.length === 0, readiness };
}

function normalizeNames(value) {
  if (Array.isArray(value))
    return value.map((item) => String(item).toLowerCase());
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function certificateCovers(hostname, names) {
  const normalized = hostname.toLowerCase();
  return names.some((name) => {
    if (name === normalized) return true;
    if (!name.startsWith("*.")) return false;
    const suffix = name.slice(1);
    return (
      normalized.endsWith(suffix) &&
      normalized.split(".").length === name.split(".").length
    );
  });
}

export async function verifyOriginTls({ api, zoneId, hostnames, probe }) {
  const mode = await api.getSslMode(zoneId);
  if (mode?.value !== "strict")
    throw new Error("Cloudflare SSL mode is not Full (strict)");
  const evidence = [];
  for (const hostname of hostnames) {
    const certificate = await probe(hostname);
    const names = normalizeNames(certificate.subjectAltNames);
    const issuer = String(certificate.issuer ?? "");
    if (!certificateCovers(hostname, names)) {
      throw new Error(`origin certificate does not cover ${hostname}`);
    }
    if (!/cloudflare origin/i.test(issuer)) {
      throw new Error(
        `origin certificate for ${hostname} is not Cloudflare Origin CA`,
      );
    }
    if (
      certificate.validNow !== true ||
      !["TLSv1.2", "TLSv1.3"].includes(certificate.protocol)
    ) {
      throw new Error(`origin TLS policy failed for ${hostname}`);
    }
    evidence.push({
      hostname,
      fingerprint256: certificate.fingerprint256,
      issuer,
      subjectAltNames: names,
      protocol: certificate.protocol,
    });
  }
  return { mode: "strict", certificates: evidence };
}

export function verifyShortLivedToken(
  result,
  { now = Date.now(), maximumLifetimeMs = 2 * 60 * 60 * 1000 } = {},
) {
  const expiresAt = Date.parse(result?.expiresOn ?? "");
  const notBefore = result?.notBefore ? Date.parse(result.notBefore) : now;
  if (
    result?.status !== "active" ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(notBefore) ||
    notBefore > now ||
    expiresAt <= now ||
    expiresAt - now > maximumLifetimeMs
  ) {
    throw new Error(
      "Cloudflare token must be active, currently valid, and expire within two hours",
    );
  }
  return { id: result.id, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyReadinessUrl(fetchImpl, url, expected = {}) {
  const response = await fetchImpl(url, {
    redirect: "manual",
    headers: { accept: "application/json", "cache-control": "no-store" },
  });
  if (response.status !== 200) return { ready: false, status: response.status };
  const body = await response.json();
  const ready =
    body?.status === "ready" &&
    (!expected.digest || body?.release?.digest === expected.digest) &&
    (!expected.revision || body?.release?.revision === expected.revision);
  return {
    ready,
    status: response.status,
    release: ready ? body.release : undefined,
  };
}

export async function readProtectedSecret(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error(
      "secret file must be a regular file with mode 0600 or stricter",
    );
  }
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 20) throw new Error("secret file is empty or too short");
  return value;
}

export async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
