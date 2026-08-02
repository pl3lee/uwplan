#!/usr/bin/env node

import {
  CloudflareApi,
  assertNonProductionZone,
  assertWorkerCapacity,
  captureOriginRecords,
  readProtectedSecret,
  switchOriginRecords,
  verifyReadinessUrl,
  verifyOriginTls,
  verifyShortLivedToken,
  writePrivateJson,
} from "./control.mjs";
import { probeOriginCertificate } from "./tls-probe.mjs";

async function expectStatus(url, status, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  if (response.status !== status) {
    throw new Error(
      `${new URL(url).pathname} returned ${response.status}, expected ${status}`,
    );
  }
  return response;
}

async function verifyWorker(config) {
  const base = new URL(config.worker.baseUrl);
  await expectStatus(new URL("/", base), 503);
  const oauth = await expectStatus(
    new URL("/api/auth/signin/github", base),
    503,
  );
  if (
    oauth.headers.get("cache-control") !== "no-store" ||
    oauth.headers.get("retry-after") !== "300"
  ) {
    throw new Error("maintenance response headers are unsafe");
  }
  await expectStatus(new URL("/api/ready", base), 200);

  const bootstrap = await readProtectedSecret(config.worker.bootstrapTokenFile);
  const bootstrapResponse = await expectStatus(
    new URL("/__uwplan/operator/bootstrap", base),
    303,
    { method: "POST", headers: { authorization: `Bearer ${bootstrap}` } },
  );
  const cookie = bootstrapResponse.headers.get("set-cookie") ?? "";
  for (const attribute of [
    "__Host-uwplan-operator=",
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=1800",
  ]) {
    if (!cookie.includes(attribute))
      throw new Error(`bypass cookie is missing ${attribute}`);
  }
  await expectStatus(new URL("/", base), 200, {
    headers: { cookie: cookie.split(";")[0] },
  });
  await expectStatus(new URL("/__uwplan/operator/bootstrap", base), 503, {
    method: "POST",
    headers: { authorization: `Bearer ${bootstrap}` },
  });

  const control = await readProtectedSecret(config.worker.controlTokenFile);
  await expectStatus(new URL("/__uwplan/operator/revoke", base), 204, {
    method: "POST",
    headers: { authorization: `Bearer ${control}` },
  });
  await expectStatus(new URL("/", base), 503, {
    headers: { cookie: cookie.split(";")[0] },
  });
  return { maintenance: true, readiness: true, bypass: true, revocation: true };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath)
    throw new Error("usage: verify-non-production.mjs <protected-config.json>");
  const config = JSON.parse(await readProtectedSecret(configPath));
  assertNonProductionZone(config.zoneName);
  const capacity = assertWorkerCapacity(config.workerUsage);
  const token = await readProtectedSecret(config.tokenFile);
  const api = new CloudflareApi({ token });
  const tokenEvidence = verifyShortLivedToken(
    await api.verifyToken(config.accountId),
  );
  const snapshot = await captureOriginRecords({
    api,
    zoneId: config.zoneId,
    zoneName: config.zoneName,
    hostnames: config.hostnames,
  });
  const forwardReadiness = () =>
    verifyReadinessUrl(
      fetch,
      config.digitalOceanReadinessUrl,
      config.digitalOceanExpectedRelease,
    );
  const reverseReadiness = () =>
    verifyReadinessUrl(
      fetch,
      config.originalReadinessUrl,
      config.originalExpectedRelease,
    );
  const originalOrigins = Object.fromEntries(
    snapshot.records.map((record) => [record.name, record.content]),
  );

  const originTls = await verifyOriginTls({
    api,
    zoneId: config.zoneId,
    hostnames: config.hostnames,
    probe: (hostname) =>
      probeOriginCertificate({
        address: config.digitalOceanOriginAddress,
        hostname,
        port: config.digitalOceanOriginPort ?? 443,
      }),
  });

  // Exercise both directions in the disposable zone. A failed forward check
  // still attempts the reverse operation before surfacing the original error.
  let forward;
  let forwardError;
  try {
    forward = await switchOriginRecords({
      api,
      snapshot,
      targetByHostname: config.digitalOceanOrigins,
      verifyReadiness: forwardReadiness,
    });
  } catch (error) {
    forwardError = error;
  }
  let reverseError;
  try {
    await switchOriginRecords({
      api,
      snapshot,
      targetByHostname: originalOrigins,
      verifyReadiness: reverseReadiness,
    });
  } catch (error) {
    reverseError = error;
  }
  if (reverseError) {
    throw new AggregateError(
      [forwardError, reverseError].filter(Boolean),
      "non-production origin exercise failed and original routing could not be verified",
    );
  }
  if (forwardError) throw forwardError;
  const worker = await verifyWorker(config);
  const evidence = {
    schemaVersion: 1,
    zoneName: config.zoneName,
    recordIds: snapshot.records.map(({ id, name, type, proxied }) => ({
      id,
      name,
      type,
      proxied,
    })),
    workerCapacity: capacity,
    token: tokenEvidence,
    originTls,
    forward,
    reverseVerified: true,
    worker,
  };
  await writePrivateJson(config.evidencePath, evidence);
  process.stdout.write(
    `${JSON.stringify({ verified: true, evidencePath: config.evidencePath })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "verification failed"}\n`,
  );
  process.exitCode = 1;
});
