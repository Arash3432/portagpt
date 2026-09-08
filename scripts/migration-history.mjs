// Historical rows are evidence, not instructions to execute SQL. Collect every
// discrepancy before choosing a normal upgrade or a schema-only baseline.
export function inspectMigrationHistory(migrations, applied) {
  const known = new Map(migrations.map((file) => [file.name, file]));
  const history = new Map();
  const integrityIssues = [];
  const externalSources = [];
  for (const row of applied) {
    const name = row?.name;
    const checksum = typeof row?.checksum === "string" ? row.checksum.trim() : "";
    if (typeof name !== "string" || name.length > 200 || !/^\d+_[a-z0-9_-]+\.sql$/i.test(name) || !/^[a-f0-9]{64}$/.test(checksum)) {
      integrityIssues.push({ code: "MIGRATION_HISTORY_INVALID", file: typeof name === "string" ? name : "invalid" });
      continue;
    }
    if (history.has(name)) integrityIssues.push({ code: "MIGRATION_HISTORY_DUPLICATE", file: name });
    history.set(name, { name, checksum });
    const source = known.get(name);
    if (source && checksum !== source.checksum) integrityIssues.push({ code: "MIGRATION_CHECKSUM_MISMATCH", file: name });
    if (!source) externalSources.push({ name, checksum });
  }
  let missingSeen = false;
  const gaps = [];
  const unrecorded = [];
  for (const file of migrations) {
    if (!history.has(file.name)) { missingSeen = true; unrecorded.push(file.name); }
    else if (missingSeen) gaps.push(file.name);
  }
  return {
    history, integrityIssues, externalSources, unrecorded, gaps,
    needsBaseline: externalSources.length > 0 || gaps.length > 0,
  };
}
