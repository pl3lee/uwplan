import { NextResponse } from "next/server";

import { getReleaseIdentity } from "@/lib/release";
import { checkDatabaseConnection } from "@/server/db";
import {
  readValidationId,
  traceHealthRequest,
  writeHealthResult,
} from "@/server/observability";
import { getRehearsalReadinessOverride } from "@/server/rehearsal-readiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const validationId = readValidationId(request);
  const startedAt = performance.now();
  return await traceHealthRequest("/api/ready", validationId, async () => {
    const databaseAvailable = await checkDatabaseConnection();
    const readinessForcedUnavailable =
      await getRehearsalReadinessOverride(request);
    const { valid: releaseValid, ...release } = getReleaseIdentity();
    const ready =
      databaseAvailable && releaseValid && !readinessForcedUnavailable;
    const database = databaseAvailable ? "available" : "unavailable";
    const status = ready ? 200 : 503;

    writeHealthResult("/api/ready", status, database, validationId, startedAt);
    return NextResponse.json(
      {
        status: ready ? "ready" : "unready",
        release,
        dependencies: {
          database,
          ...(readinessForcedUnavailable
            ? { validation: "forced-unready" }
            : {}),
        },
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(validationId ? { "x-uwplan-validation-id": validationId } : {}),
        },
      },
    );
  });
}
