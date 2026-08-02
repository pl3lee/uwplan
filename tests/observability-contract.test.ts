/** @jest-environment node */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

describe("versioned observability contracts", () => {
  it("keeps application, Alloy, and validator telemetry vocabulary aligned", () => {
    const result = spawnSync(
      process.execPath,
      ["ops/observability/check-contract.mjs"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 0,
        stdout: "telemetry contract valid\n",
      }),
    );
  });

  it("uses supported scoped Grafana provisioning without replacing routing policy", () => {
    const provisioning = parse(
      readFileSync(
        "ops/observability/grafana/rehearsal-readiness-alert.yaml",
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(provisioning).not.toHaveProperty("policies");
    expect(provisioning).toEqual(
      expect.objectContaining({
        apiVersion: 1,
        contactPoints: [
          expect.objectContaining({
            receivers: [
              expect.objectContaining({
                uid: "uwplan-discord-rehearsal",
                type: "discord",
                settings: {
                  use_discord_username: true,
                  url: "${UWPLAN_DISCORD_WEBHOOK_URL}",
                },
                disableResolveMessage: false,
              }),
            ],
          }),
        ],
        groups: [
          expect.objectContaining({
            rules: [
              expect.objectContaining({
                uid: "uwplan-rehearsal-readiness",
                notification_settings: {
                  receiver: "UWPlan rehearsal Discord",
                  group_wait: "5s",
                  group_interval: "10s",
                  repeat_interval: "4h",
                },
              }),
            ],
          }),
        ],
      }),
    );
    expect(JSON.stringify(provisioning)).not.toContain("secureSettings");
  });
});
