import { createServer } from "node:http";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const expectedPlanId = process.env.EXPECTED_PLAN_ID;
const expectedUserId = process.env.EXPECTED_USER_ID;
if (!databaseUrl || !expectedPlanId || !expectedUserId) process.exit(1);

const sql = postgres(databaseUrl, { connect_timeout: 3, max: 1 });
const server = createServer(async (request, response) => {
  if (request.url !== "/api/previous-schema-probe") {
    response.writeHead(404).end();
    return;
  }
  try {
    const rows = await sql`
      select id, user_id
      from plan
      where id = ${expectedPlanId}::uuid and user_id = ${expectedUserId}
    `;
    if (rows.length !== 1) throw new Error("expected plan was not readable");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status: "previous-runtime-compatible",
        plan: { id: rows[0].id, userId: rows[0].user_id },
      }),
    );
  } catch {
    response.writeHead(503, {
      "cache-control": "no-store",
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ status: "previous-runtime-incompatible" }));
  }
});

server.listen(5000, "0.0.0.0");

async function shutdown() {
  server.close();
  await sql.end({ timeout: 1 }).catch(() => undefined);
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
