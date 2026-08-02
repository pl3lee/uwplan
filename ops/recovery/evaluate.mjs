#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { evaluateRecoveryPolicy } from "./policy.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(64);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--observations") {
  fail("usage: evaluate.mjs --observations <sanitized-observations.json>");
}

let observations;
try {
  const parsed = JSON.parse(readFileSync(args[1], "utf8"));
  observations = parsed.observations;
} catch {
  fail("recovery observations are unreadable");
}

try {
  const decision = evaluateRecoveryPolicy(observations);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exitCode = decision.accepted ? 0 : 2;
} catch {
  fail("recovery observations are invalid");
}
