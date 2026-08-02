import { NextResponse } from "next/server";

import { getReleaseIdentity } from "@/lib/release";
import { checkDatabaseConnection } from "@/server/db";
import { traceHealthRequest, writeHealthResult } from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  return await traceHealthRequest("/api/ready", async () => {
    const databaseAvailable = await checkDatabaseConnection();
    const { valid: releaseValid, ...release } = getReleaseIdentity();
    const ready = databaseAvailable && releaseValid;
    const database = databaseAvailable ? "available" : "unavailable";
    const status = ready ? 200 : 503;

    writeHealthResult("/api/ready", status, database);
    return NextResponse.json(
      {
        status: ready ? "ready" : "unready",
        release,
        dependencies: { database },
      },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  });
}
