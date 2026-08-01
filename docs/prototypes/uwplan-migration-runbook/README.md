# PROTOTYPE — UWPlan migration runbook walkthrough

This throwaway prototype asks one question: **can an operator traverse every rehearsal, cutover, abort, rollback, and seven-day handoff state without making an unstated choice?**

It has two artifacts:

- [`RUNBOOK.md`](RUNBOOK.md) is the rough integrated operator runbook.
- `machine.ts` and `tui.ts` expose the runbook's state transitions in a tiny terminal walkthrough.

Nothing here executes infrastructure or connects to a database. State is in memory and disappears on exit. The command shapes in the runbook name scripts that must be implemented, reviewed, and rehearsed before the runbook can be used.

Run it from the repository root:

```sh
npm run prototype:migration-runbook
```

Drive the happy path with `p`, advance clocks with `t`, record the sole operator's go decision with `g`, and declare a write epoch with `e`. Press `f` or `a` at different points to see whether the runbook sends the operator to rehearsal remediation, unchanged-source recovery, or reverse migration.
