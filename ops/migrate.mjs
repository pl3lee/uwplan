import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const startedAt = new Date().toISOString();
const databaseUrl = process.env.DATABASE_URL;
const migrationsFolder = process.env.MIGRATIONS_DIRECTORY ?? "/app/drizzle";
const releaseDigest = process.env.RELEASE_DIGEST ?? "unavailable";
const releaseRevision = process.env.RELEASE_REVISION ?? "unknown";

function evidence(status, attributes = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "uwplan-migrator",
    event: "database.migration",
    status,
    started_at: startedAt,
    release_digest: releaseDigest,
    release_revision: releaseRevision,
    ...attributes,
  });
}

if (!databaseUrl) {
  console.error(evidence("failure", { error_type: "MissingDatabaseUrl" }));
  process.exit(1);
}

const client = postgres(databaseUrl, {
  connect_timeout: 3,
  max: 1,
});

try {
  await migrate(drizzle(client), { migrationsFolder });
  const [result] = await client`
    select count(*)::integer as count
    from drizzle.__drizzle_migrations
  `;
  console.log(
    evidence("success", {
      applied_migration_count: result?.count ?? 0,
    }),
  );
} catch (error) {
  console.error(
    evidence("failure", {
      error_type: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 1 }).catch(() => undefined);
}
