import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export const sessionCookieName = "uwplan_session";
export const sessionToken = () => randomBytes(32).toString("base64url");

export function seedRedisSession(
  userID: string,
  token: string,
  expired: boolean,
) {
  const container = process.env.E2E_REDIS_CONTAINER;
  if (!container?.startsWith("uwplan-e2e-redis-"))
    throw new Error("Redis sessions require the disposable Go E2E runner");
  const hash = createHash("sha256").update(token).digest("base64url");
  const value = JSON.stringify({
    id: randomUUID(),
    user_id: userID,
    token_hash: hash,
    created_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + (expired ? -60_000 : 3_600_000),
    ).toISOString(),
  });
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "redis-cli",
      "-x",
      "EVAL",
      "return redis.call('SET', KEYS[1], ARGV[1], 'EX', 3600)",
      "1",
      `uwplan:session:${hash}`,
    ],
    { input: value, stdio: ["pipe", "pipe", "pipe"] },
  );
}
