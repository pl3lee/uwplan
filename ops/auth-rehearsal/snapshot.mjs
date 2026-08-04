#!/usr/bin/env node

import postgres from "postgres";
import {
  ROW_DIGEST_CONTRACT,
  digestCanonicalRowBatches,
} from "../database/row-digest.mjs";

function fail() {
  process.stderr.write("candidate database snapshot failed\n");
  process.exit(1);
}

function count(value) {
  return Number(value ?? 0);
}

async function readInput() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input ? JSON.parse(input) : {};
}

async function preparedSnapshot(sql) {
  await sql.unsafe(`
    SET LOCAL TIME ZONE 'UTC';
    SET LOCAL DateStyle = 'ISO, YMD';
    SET LOCAL bytea_output = 'hex';
    SET LOCAL extra_float_digits = 3;
  `);
  const rows = await sql.unsafe(`
    select
      current_database() as database,
      (select count(*)::integer from public.session) as session,
      (select count(*)::integer from public.verification_token) as verification_token,
      (select count(*)::integer from public.account) as account
  `);
  const row = rows[0] ?? {};
  const preserved = {};
  for (const [name, table] of Object.entries({
    user: 'public."user"',
    plan: "public.plan",
    schedule: "public.schedule",
  })) {
    preserved[name] = await digestCanonicalRowBatches(
      sql
        .unsafe(`
          SELECT replace(
            encode(convert_to(row_to_json(row_data)::text, 'UTF8'), 'base64'),
            E'\\n',
            ''
          ) AS "canonicalRow"
          FROM ${table} AS row_data
          ORDER BY row_to_json(row_data)::text COLLATE "C"
        `)
        .cursor(1),
    );
  }
  return {
    database: row.database,
    rowDigest: ROW_DIGEST_CONTRACT,
    authArtifactCounts: {
      session: count(row.session),
      verificationToken: count(row.verification_token),
      account: count(row.account),
    },
    preservedCounts: {
      user: preserved.user.count,
      plan: preserved.plan.count,
      schedule: preserved.schedule.count,
    },
    preservedDigests: {
      user: preserved.user.sha256,
      plan: preserved.plan.sha256,
      schedule: preserved.schedule.sha256,
    },
  };
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

async function acceptanceSnapshot(sql) {
  const identities = await readInput();
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
      google: await identitySnapshot(sql, identities.google),
      github: await identitySnapshot(sql, identities.github),
    },
  };
}

async function main() {
  const mode = process.argv[2];
  if (!new Set(["prepared", "acceptance"]).has(mode)) fail();
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 2,
    prepare: false,
  });
  try {
    const result =
      mode === "prepared"
        ? await sql.begin(
            "isolation level repeatable read read only",
            preparedSnapshot,
          )
        : await acceptanceSnapshot(sql);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch(fail);
