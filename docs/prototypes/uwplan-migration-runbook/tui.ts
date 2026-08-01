import * as readline from "node:readline";
import {
  initialState,
  phaseInfo,
  reduceMigration,
  type Action,
  type MigrationState,
} from "./machine";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

let state = initialState();

function render(current: MigrationState) {
  console.clear();
  const info = phaseInfo[current.phase];
  console.log(`${bold}PROTOTYPE — UWPlan migration runbook state walk${reset}`);
  console.log(
    `${dim}No infrastructure is touched. State is memory-only.${reset}\n`,
  );
  console.log(`${bold}Phase${reset}: ${info.title}`);
  console.log(`${bold}Owner${reset}: ${info.owner}`);
  console.log(`${bold}Public mode${reset}: ${current.publicMode}`);
  console.log(`${bold}Authoritative data${reset}: ${current.authority}`);
  console.log(
    `${bold}DigitalOcean write epoch${reset}: ${current.digitalOceanWriteEpoch ? "DECLARED" : "not declared"}`,
  );
  console.log(
    `${bold}Clocks${reset}: soak=${current.soakHours}h maintenance=${current.maintenanceMinutes}m post-open=${current.postOpenMinutes}m stable=${current.stableDays}d`,
  );
  console.log(`${bold}Last decision${reset}: ${current.lastDecision}`);
  console.log(`${bold}Path${reset}: ${current.history.join(" → ")}\n`);
  console.log(`${bold}Required evidence${reset}`);
  info.evidence.forEach((item) => console.log(`  • ${item}`));
  console.log(`\n${bold}Stop condition${reset}: ${info.stop}\n`);
  console.log(
    `${bold}[p]${reset} ${dim}pass gate${reset}  ${bold}[f]${reset} ${dim}fail gate${reset}  ${bold}[a]${reset} ${dim}abort${reset}  ${bold}[t]${reset} ${dim}advance clock${reset}`,
  );
  console.log(
    `${bold}[g]${reset} ${dim}record GO${reset}  ${bold}[e]${reset} ${dim}declare write epoch${reset}  ${bold}[r]${reset} ${dim}reset${reset}  ${bold}[q]${reset} ${dim}quit${reset}`,
  );
}

const actions: Record<string, Action> = {
  p: { type: "pass" },
  f: { type: "fail" },
  a: { type: "abort" },
  t: { type: "tick" },
  g: { type: "go" },
  e: { type: "epoch" },
  r: { type: "reset" },
};

const interface_ = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt() {
  render(state);
  interface_.question("\nAction: ", (answer) => {
    const key = answer.trim().toLowerCase().slice(0, 1);
    if (key === "q") {
      interface_.close();
      return;
    }
    const action = actions[key];
    if (action) state = reduceMigration(state, action);
    else state = { ...state, lastDecision: "Unknown action." };
    prompt();
  });
}

interface_.on("close", () => {
  console.log("\nPrototype closed. No state was persisted.");
});

prompt();
