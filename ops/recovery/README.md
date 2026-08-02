# Recovery and resource gates

`watchdog.mjs` is a root-owned, host-level one-shot watchdog. The accompanying
systemd timer runs it once per minute. State and JSONL evidence live under
`/var/lib/uwplan-watchdog` with mode `0700`/`0600` permissions.

The watchdog uses fixed production paths and a fixed Compose project. It checks
`/api/live`, then asks Docker Compose to restart **only** `app` after three
consecutive failures. PostgreSQL readiness failures and every observed restart
counter increase emit alerting evidence; there is no database-restart command in
the watchdog implementation.

Install the unit from an authenticated root session:

```sh
install -d -o root -g root -m 0700 /var/lib/uwplan-watchdog
install -o root -g root -m 0644 ops/recovery/uwplan-watchdog.service /etc/systemd/system/uwplan-watchdog.service
install -o root -g root -m 0644 ops/recovery/uwplan-watchdog.timer /etc/systemd/system/uwplan-watchdog.timer
systemctl daemon-reload
systemctl enable --now uwplan-watchdog.timer
```

Forward `uwplan-watchdog` journal JSON to the private observability stack and
route events whose status is `alerting` to the existing private Discord contact
point. A missing database-readiness alert or an unnoticed restart counter is a
hard stop.

## Resource acceptance

Export sanitized, one-minute observations from Grafana as:

```json
{
  "observations": [
    {
      "windowSeconds": 60,
      "events": { "oomKills": 0, "memoryLimitKills": 0 },
      "restarts": {
        "resourceCaused": 0,
        "unexplained": 0,
        "counterIncrease": 0,
        "noticed": 0
      },
      "host": {
        "memoryAvailablePercent": 30,
        "activeSwapBytesPerSecond": 0,
        "cpuPercent": 20,
        "diskUsedPercent": 30,
        "diskFreeBytes": 10737418240,
        "inodeUsedPercent": 10
      },
      "services": {
        "app": { "memoryLimitPercent": 50 },
        "db": { "memoryLimitPercent": 50 },
        "alloy": { "memoryLimitPercent": 50 }
      },
      "availability": {
        "successfulProbes": 1,
        "totalProbes": 1,
        "maximumConsecutiveFailures": 0,
        "plannedRecoveryMilliseconds": 60000
      },
      "latency": {
        "externalReadinessMilliseconds": [100],
        "coreRequestMilliseconds": [300]
      }
    }
  ]
}
```

Then enforce the policy:

```sh
node ops/recovery/evaluate.mjs --observations /restricted/evidence/observations.json > /restricted/evidence/resource-decision.json
```

Exit `0` means accepted. Exit `2` is an enforced `block-cutover`,
`investigate`, or `resize-repeat-soak` decision. Any OOM, memory-limit kill, or
resource-caused restart emits `minimumHostMemoryBytes: 2147483648` and requires
a full repeat soak. The evaluator also encodes the accepted five-minute,
three-period, 80%, 5 GiB, availability, recovery, and response-time gates.

Feed the resulting sanitized JSON to the migration orchestrator with
`record-runtime-decision`; the migration evidence bundle records the outcome
and reason count without embedding raw observations.

## Controlled rehearsal failure injection

The operational injector is fail-closed outside rehearsal. It requires root,
`UWPLAN_FAILURE_INJECTION_ENVIRONMENT=rehearsal`,
`UWPLAN_FAILURE_INJECTION_HOST=v2.uwplan.com`, and a root-created marker whose
exact content is `v2.uwplan.com` at
`/etc/uwplan/allow-rehearsal-failure-injection`. It simulates three failed app
probes through the same watchdog state machine, performs the app-only Compose
restart, injects a database-readiness failure alert, and requires the database
restart counter to remain unchanged. Remove the marker immediately after the
drill. Never create it on production.
