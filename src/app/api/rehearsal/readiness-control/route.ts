import { NextResponse } from "next/server";

import { setRehearsalReadiness } from "@/server/rehearsal-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = JSON.parse(await request.text()) as unknown;
  } catch {
    // Invalid JSON is handled as an invalid request below.
  }
  const result = await setRehearsalReadiness(request, body);
  if (result.status === "not-found") {
    return NextResponse.json({ status: "not-found" }, { status: 404 });
  }
  if (result.status === "invalid-request") {
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }
  return NextResponse.json(
    { status: result.state, validation_id: result.validationId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
