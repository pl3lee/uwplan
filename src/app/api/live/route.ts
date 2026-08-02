import { NextResponse } from "next/server";

import {
  readValidationId,
  traceHealthRequest,
  writeHealthResult,
} from "@/server/observability";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const validationId = readValidationId(request);
  const startedAt = performance.now();
  return await traceHealthRequest("/api/live", validationId, () => {
    writeHealthResult("/api/live", 200, undefined, validationId, startedAt);
    return NextResponse.json(
      { status: "live" },
      {
        headers: {
          "Cache-Control": "no-store",
          ...(validationId ? { "x-uwplan-validation-id": validationId } : {}),
        },
      },
    );
  });
}
