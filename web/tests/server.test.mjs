import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

test("production server keeps callback secrets out of logs and responses", {
  timeout: 20_000,
}, async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn("pnpm", ["start"], {
    cwd: new URL("..", import.meta.url),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      API_ORIGIN: "http://127.0.0.1:1",
    },
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) process.kill(-child.pid, "SIGTERM");
    await exited;
  });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await fetch(`${origin}/signin`)).ok;
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.ok(ready, "production server must become ready");
  const sentinel = "callback-credential-must-not-leak";
  const response = await fetch(
    `${origin}/api/auth/callback/google?code=${sentinel}&state=${sentinel}`,
    {
      headers: {
        Cookie: `uwplan_session=${sentinel}`,
        Authorization: `Bearer ${sentinel}`,
      },
    },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    title: "Bad Gateway",
    status: 502,
    detail: "API unavailable",
  });
  await delay(100);
  assert.ok(
    !output.includes(sentinel),
    "callback secrets must not appear in server output",
  );
});
