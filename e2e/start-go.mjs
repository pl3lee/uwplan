import { spawn } from "node:child_process";

if (
  process.env.E2E_RUNTIME !== "go" ||
  !process.env.E2E_API_CONTAINER?.startsWith("uwplan-e2e-api-") ||
  !process.env.E2E_DATABASE_URL
)
  throw new Error("Use the disposable Go E2E runner");

const children = [];
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop());
const launch = (command, args, env) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("error", () => {
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code ?? 1;
      stop();
    }
  });
  return child;
};
const api = launch("docker", ["attach", process.env.E2E_API_CONTAINER], {});
for (let attempt = 0; attempt < 100; attempt++) {
  if (stopping || api.exitCode !== null || api.signalCode !== null)
    throw new Error("Go API exited before readiness");
  try {
    if ((await fetch(`${process.env.API_ORIGIN}/api/ready`)).ok) break;
  } catch {}
  if (attempt === 99) {
    stop();
    throw new Error("Go API did not become ready");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
launch(process.execPath, ["web/server.mjs"], {
  HOST: "localhost",
  PORT: process.env.E2E_PORT,
});
