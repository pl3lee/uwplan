#!/usr/bin/env node

import { checkMigrationCompatibility } from "./check-migration-compatibility.mjs";

try {
  const compatibility = checkMigrationCompatibility(
    process.env.MIGRATIONS_DIRECTORY ?? "/app/drizzle",
    "/app/ops/deploy/migration-compatibility.json",
  );
  process.stdout.write(
    `${JSON.stringify({
      service: "uwplan-migrator",
      event: "database.migration.compatibility",
      status: "accepted",
      ...compatibility,
    })}\n`,
  );
  await import("../migrate.mjs");
} catch {
  process.stderr.write(
    `${JSON.stringify({
      service: "uwplan-migrator",
      event: "database.migration.compatibility",
      status: "rejected",
      contract: "expand-only",
    })}\n`,
  );
  process.exitCode = 1;
}
