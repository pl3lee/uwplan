import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = "/app/ops/deploy/migration-compatibility.json";
const journalPath = "/app/drizzle/meta/_journal.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.migrations["0010_expand_only.sql"] = {
  kind: "expand-only",
  sha256: "8eddad2dde4c381071d9aac0029ada7ac7e6ee5f3af77b553053eea5774d575b",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
journal.entries.push({
  idx: 10,
  version: "7",
  when: 1785643200000,
  tag: "0010_expand_only",
  breakpoints: true,
});
writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
