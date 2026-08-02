#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import postgres from "postgres";

import {
  readProtectedEnvironment,
  validateRehearsalConfiguration,
  validateRehearsalEvidence,
} from "./protocol.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readProtectedJson(path) {
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("browser attestation must be a mode-0600 file");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function count(value) {
  return Number(value ?? 0);
}

async function identitySnapshot(sql, identity) {
  const userRows = await sql`
    select id from "user" where lower(email) = lower(${identity.email})
  `;
  const userIds = userRows.map(({ id }) => id);
  if (userIds.length === 0) {
    return {
      users: 0,
      accounts: { google: 0, github: 0 },
      plans: 0,
      schedules: { total: 0, default: 0, marker: 0 },
      termRanges: 0,
    };
  }

  const [accountRows, planRows, scheduleRows, termRangeRows] =
    await Promise.all([
      sql`
        select provider, count(*)::integer as count
        from account where user_id in ${sql(userIds)}
        group by provider
      `,
      sql`
        select count(*)::integer as count
        from plan where user_id in ${sql(userIds)}
      `,
      sql`
        select
          count(*)::integer as total,
          count(*) filter (where schedule.name = 'Default')::integer as default,
          count(*) filter (
            where schedule.name = ${identity.marker ?? "__no_marker__"}
          )::integer as marker
        from schedule
        inner join plan on plan.id = schedule.plan_id
        where plan.user_id in ${sql(userIds)}
      `,
      sql`
        select count(*)::integer as count
        from user_term_range where user_id in ${sql(userIds)}
      `,
    ]);
  const accountCounts = Object.fromEntries(
    accountRows.map(({ provider, count: providerCount }) => [
      provider,
      count(providerCount),
    ]),
  );

  return {
    users: userRows.length,
    accounts: {
      google: accountCounts.google ?? 0,
      github: accountCounts.github ?? 0,
    },
    plans: count(planRows[0]?.count),
    schedules: {
      total: count(scheduleRows[0]?.total),
      default: count(scheduleRows[0]?.default),
      marker: count(scheduleRows[0]?.marker),
    },
    termRanges: count(termRangeRows[0]?.count),
  };
}

async function databaseSnapshot(configuration) {
  const sql = postgres(configuration.databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 2,
    prepare: false,
  });
  try {
    const databaseIdentity = await sql`
      select current_database() as database, current_user as role
    `;
    return {
      schemaVersion: 1,
      database: {
        name: databaseIdentity[0]?.database,
        role: databaseIdentity[0]?.role,
        productionContacted: false,
      },
      identities: {
        google: await identitySnapshot(sql, configuration.identities.google),
        github: await identitySnapshot(sql, configuration.identities.github),
        crossProvider: await identitySnapshot(
          sql,
          configuration.identities.crossProvider,
        ),
      },
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function verifyHttpBoundary(configuration, sensitiveValues) {
  const request = async (path, credentials) => {
    const headers = {};
    if (credentials) {
      headers.authorization = `Basic ${Buffer.from(
        `${credentials.user}:${credentials.password}`,
      ).toString("base64")}`;
    }
    const response = await fetch(`${configuration.publicUrl}${path}`, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (sensitiveValues.some((value) => value && body.includes(value))) {
      throw new Error("rehearsal HTTP response exposed protected data");
    }
    return { status: response.status, body };
  };

  const readiness = await request("/api/ready");
  const missing = await request("/signin");
  const wrong = await request("/api/auth/callback/google", {
    user: configuration.basicUser,
    password: `${configuration.basicPassword}-wrong`,
  });
  const accepted = await request("/signin", {
    user: configuration.basicUser,
    password: configuration.basicPassword,
  });
  const stripped = await request("/api/rehearsal/request-boundary", {
    user: configuration.basicUser,
    password: configuration.basicPassword,
  });

  let strippedBody;
  try {
    strippedBody = JSON.parse(stripped.body);
  } catch {
    throw new Error("rehearsal request-boundary proof was not JSON");
  }
  if (
    readiness.status !== 200 ||
    missing.status !== 401 ||
    wrong.status !== 401 ||
    accepted.status !== 200 ||
    stripped.status !== 200 ||
    strippedBody?.status !== "accepted" ||
    strippedBody?.authorization !== "absent" ||
    strippedBody?.boundary !== "rehearsal-basic-auth" ||
    missing.body.includes("Sign in to your account") ||
    wrong.body.includes("Sign in to your account")
  ) {
    throw new Error("rehearsal Caddy authentication boundary failed");
  }
}

async function main() {
  const operatorEnvironment = readProtectedEnvironment(
    process.env.UWPLAN_AUTH_REHEARSAL_ENV_FILE,
  );
  const rehearsalEnvironment = readProtectedEnvironment(
    operatorEnvironment.UWPLAN_REHEARSAL_APP_ENV_FILE,
  );
  const configuration = validateRehearsalConfiguration(
    rehearsalEnvironment,
    operatorEnvironment,
  );
  const attestation = readProtectedJson(
    operatorEnvironment.UWPLAN_REHEARSAL_ATTESTATION_FILE,
  );
  const sensitiveValues = [
    ...Object.values(rehearsalEnvironment),
    ...Object.values(configuration.identities).map(({ email }) => email),
    configuration.basicPassword,
  ].filter((value) => typeof value === "string" && value.length >= 6);

  await verifyHttpBoundary(configuration, sensitiveValues);
  const snapshot = await databaseSnapshot(configuration);
  const evidence = validateRehearsalEvidence(
    configuration,
    snapshot,
    attestation,
  );
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "auth rehearsal failed");
});
