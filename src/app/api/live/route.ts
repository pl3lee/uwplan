import { NextResponse } from "next/server";

import { traceHealthRequest, writeHealthResult } from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  return await traceHealthRequest("/api/live", () => {
    writeHealthResult("/api/live", 200);
    return NextResponse.json(
      { status: "live" },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
