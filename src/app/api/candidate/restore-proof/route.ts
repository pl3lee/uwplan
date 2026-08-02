import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/server/db";
import { getSchedules, getUserPlan, createSchedule } from "@/server/db/queries";
import { plans, users } from "@/server/db/schema";
import {
  authorizeCandidateRestoreProof,
  candidateRestoreProofIdentity,
  resolveCandidateRestoreProofConfiguration,
} from "@/server/candidate-restore-proof";

export const dynamic = "force-dynamic";

const runIdPattern = /^[0-9]{8}T[0-9]{9}Z$/;
export async function POST(request: Request) {
  const configured = resolveCandidateRestoreProofConfiguration(process.env);
  if (
    !configured ||
    !authorizeCandidateRestoreProof(request, configured.token)
  ) {
    return new NextResponse(null, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !new Set(["write", "verify"]).has(
      (body as { action?: unknown }).action as string,
    ) ||
    !runIdPattern.test((body as { proofRunId?: string }).proofRunId ?? "")
  ) {
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }

  const action = (body as { action: "write" | "verify" }).action;
  const proofRunId = (body as { proofRunId: string }).proofRunId;
  const identity = candidateRestoreProofIdentity(proofRunId);
  try {
    if (action === "write") {
      await db.insert(users).values({
        id: identity.userId,
        email: identity.email,
      });
      await getUserPlan(identity.userId);
      await createSchedule(identity.userId, identity.scheduleName);
    }

    const rows = await db
      .select({ email: users.email })
      .from(users)
      .innerJoin(plans, eq(plans.userId, users.id))
      .where(
        and(eq(users.id, identity.userId), eq(users.email, identity.email)),
      );
    if (rows.length !== 1) {
      throw new Error("workflow identity was not preserved");
    }
    const schedules = await getSchedules(identity.userId);
    if (
      schedules.filter(({ name }) => name === identity.scheduleName).length !==
      1
    ) {
      throw new Error("workflow proof was not preserved");
    }

    return NextResponse.json({
      schemaVersion: 1,
      event: "database.workflow-proof",
      status: action === "write" ? "written" : "verified",
      proofRunId,
      candidateDatabase: configured.database,
      applicationRole: "uwplan_app",
      workflow: "user-plan-schedule",
      recordCount: 3,
      proofSha256: identity.proofSha256,
    });
  } catch {
    return NextResponse.json({ status: "workflow-failed" }, { status: 409 });
  }
}
