import { NextResponse } from "next/server";

import { resolveAuthRehearsalBoundaryConfiguration } from "@/server/auth/rehearsal";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const configuration = resolveAuthRehearsalBoundaryConfiguration(process.env);
  if (
    !configuration ||
    new URL(request.url).hostname !== configuration.hostname
  ) {
    return new NextResponse(null, { status: 404 });
  }

  if (request.headers.has("authorization")) {
    return NextResponse.json(
      { status: "rejected", authorization: "present" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    status: "accepted",
    authorization: "absent",
    boundary: "rehearsal-basic-auth",
  });
}
