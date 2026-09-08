// Log a bounded stream of metadata events, not one huge JSON line that the
// platform can truncate. Never serialize environment, user records or SQL.
const identifier = (value) => typeof value === "string" && /^[a-z0-9_.-]{1,240}$/i.test(value) ? value : "redacted";
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : undefined;

export function migrationReportEvents(report) {
  const issues = report.schemaIssues || report.compatibility?.schemaIssues || [];
  const events = [{
    event: "migration.report.summary", readOnly: true, compatible: report.compatible === true,
    historyTableExists: report.historyTableExists === true,
    missingSourceCount: report.missingSources?.length || 0,
    unrecordedCanonicalCount: report.unrecordedCanonicalCount ?? report.pendingCount ?? 0,
    schemaIssueCount: issues.length,
    code: report.compatibility?.code ? identifier(report.compatibility.code) : undefined,
  }];
  for (const source of report.sourceFiles || []) events.push({
    event: "migration.report.source", file: identifier(source.file), status: identifier(source.status),
    sourceChecksum: hash(source.sourceChecksum), recordedChecksum: hash(source.recordedChecksum),
  });
  for (const source of report.missingSources || []) events.push({
    event: "migration.report.external_source", file: identifier(source.file),
    recordedChecksum: hash(source.recordedChecksum),
  });
  for (const issue of report.issues || []) events.push({
    event: "migration.report.history_issue", code: identifier(issue.code), file: identifier(issue.file),
  });
  for (const issue of issues) {
    events.push({ event: "migration.report.schema_issue", section: identifier(issue.section), object: identifier(issue.object), reason: identifier(issue.reason) });
    if (issue.section === "columns") {
      const column = (report.schemaShape || []).find((row) => `${row.table_name}.${row.column_name}` === issue.object);
      if (column) events.push({
        event: "migration.report.column", object: identifier(issue.object),
        type: typeof column.data_type === "string" && /^[a-z0-9_ (),[\]]{1,100}$/i.test(column.data_type) ? column.data_type : "redacted",
        notNull: column.not_null === true,
      });
    }
  }
  events.push({ event: "migration.report.complete", readOnly: true, events: events.length + 1 });
  return events;
}

export async function reportStartupFailure(error, { readStatus, log = (event) => console.error(JSON.stringify(event)) }) {
  if (!error || typeof error.code !== "string" || !/^MIGRATION_(SOURCE_|HISTORY_|CHECKSUM_|SCHEMA_|BASELINE_)/.test(error.code)) return false;
  try {
    for (const event of migrationReportEvents(await readStatus())) log(event);
    return true;
  } catch (diagnosticError) {
    log({ event: "migration.report.failed", readOnly: true,
      code: identifier(diagnosticError?.code || "DIAGNOSTIC_UNAVAILABLE") });
    return false;
  }
}
