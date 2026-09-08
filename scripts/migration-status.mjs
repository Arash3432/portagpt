import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { loadMigrations, safeMigrationFailure } from "./migrate.mjs";
import { normalizeEnvironment } from "./preflight.mjs";
import { compareSchemaContract, loadSchemaContract, readSchemaSnapshot, verifyDatabaseCompatibility } from "./migration-compatibility.mjs";
import { inspectMigrationHistory } from "./migration-history.mjs";

// This command deliberately reads schema metadata only. In particular it must
// never create schema_migrations, rewrite a checksum or replay a SQL file.
export function summarizeMigrationHistory(migrations, applied) {
  const sourceByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const historyByName = new Map();
  const issues = inspectMigrationHistory(migrations, applied).integrityIssues.filter((issue) => issue.code === "MIGRATION_HISTORY_INVALID");
  for (const row of applied) {
    if (historyByName.has(row.name)) issues.push({ code: "MIGRATION_HISTORY_DUPLICATE", file: row.name });
    historyByName.set(row.name, row);
  }
  const sourceFiles = migrations.map((migration) => {
    const row = historyByName.get(migration.name);
    const recordedChecksum = row?.checksum?.trim();
    const status = !row ? "pending" : recordedChecksum === migration.checksum ? "applied" : "checksum_mismatch";
    if (status === "checksum_mismatch") issues.push({ code: "MIGRATION_CHECKSUM_MISMATCH", file: migration.name });
    return { file: migration.name, status, sourceChecksum: migration.checksum, ...(row ? { recordedChecksum } : {}) };
  });
  const missingSources = applied.filter((row) => !sourceByName.has(row.name)).map((row) => {
    const recordedChecksum = row.checksum?.trim();
    issues.push({ code: "MIGRATION_SOURCE_MISSING", file: row.name });
    return {
      file: row.name,
      recordedChecksum,
      // A byte-for-byte match can identify a renamed source. This diagnostic
      // does not authorize it, change history or infer identity from a name.
      matchingBundledSources: migrations.filter((migration) => migration.checksum === recordedChecksum).map((migration) => migration.name),
    };
  });
  let pendingSeen = false;
  for (const migration of migrations) {
    if (!historyByName.has(migration.name)) pendingSeen = true;
    else if (pendingSeen) issues.push({ code: "MIGRATION_HISTORY_GAP", file: migration.name });
  }
  return {
    compatible: issues.length === 0,
    issues,
    sourceFiles,
    missingSources,
    pendingCount: sourceFiles.filter((file) => file.status === "pending").length,
    action: missingSources.length ? "RESTORE_ORIGINAL_MIGRATION_SOURCES" : issues.length ? "REVIEW_MIGRATION_HISTORY" : "NONE",
  };
}

export async function buildMigrationStatus(migrations, applied, snapshot) {
  const report = summarizeMigrationHistory(migrations, applied);
  const inspected = inspectMigrationHistory(migrations, applied);
  const existingSchemaWithoutHistory = !applied.length && snapshot.tables.some((row) => ["users", "conversations", "messages", "plans"].includes(row.table_name));
  if (inspected.needsBaseline || existingSchemaWithoutHistory || inspected.integrityIssues.length) {
    // Collect schema differences independently of history failures. The next
    // deployment must not reveal just one more filename at a time.
    const contract = await loadSchemaContract();
    report.schemaIssues = compareSchemaContract(contract.schema, snapshot).issues;
    try {
      const warning = await verifyDatabaseCompatibility(migrations, applied, async () => snapshot);
      report.compatible = true;
      report.historyNotices = report.issues;
      report.issues = [];
      report.action = "NONE";
      report.compatibility = warning;
      report.unrecordedCanonicalCount = report.pendingCount;
      report.pendingCount = 0;
      for (const file of report.sourceFiles) if (file.status === "pending") file.status = "not_recorded";
    } catch (error) {
      report.compatible = false;
      report.action = "REVIEW_AUTOMATIC_REPORT";
      report.compatibility = {
        verified: false, code: safeMigrationFailure(error).code,
        ...(error.schemaIssues ? { schemaIssues: error.schemaIssues } : {}),
      };
    }
  }
  return report;
}

export async function readMigrationStatus({ databaseUrl, sslMode = "disable", directory, connection = {} } = {}) {
  const migrations = await loadMigrations(directory);
  const sql = postgres(databaseUrl, {
    max: 1, ssl: sslMode === "require" ? "require" : false, prepare: false,
    connect_timeout: 10, max_lifetime: null, onnotice: () => {}, connection,
  });
  try {
    return await sql.begin(async (tx) => {
      await tx`set transaction read only`;
      await tx`set local statement_timeout = '15s'`;
      await tx`set local lock_timeout = '5s'`;
      const [{ history_table: historyTable }] = await tx`select to_regclass('schema_migrations')::text as history_table`;
      const applied = historyTable ? await tx`select name, checksum from schema_migrations order by name` : [];
      const snapshot = await readSchemaSnapshot((source) => tx.unsafe(source));
      const report = await buildMigrationStatus(migrations, applied, snapshot);
      // Do not expose column defaults or function bodies in a support report.
      const schemaShape = snapshot.columns.map(({ table_name, column_name, data_type, not_null }) => ({ table_name, column_name, data_type, not_null }));
      return {
        event: "migration.status", readOnly: true, historyTableExists: Boolean(historyTable),
        ...report, schemaShape,
      };
    });
  } finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const env = normalizeEnvironment(process.env);
    let url;
    try { url = new URL(env.DATABASE_URL); } catch { throw Object.assign(new Error("DATABASE_URL_INVALID"), { code: "DATABASE_URL_INVALID" }); }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw Object.assign(new Error("DATABASE_URL_INVALID"), { code: "DATABASE_URL_INVALID" });
    const sslMode = env.DATABASE_SSL_MODE || "disable";
    if (!["disable", "require"].includes(sslMode)) throw Object.assign(new Error("DATABASE_SSL_MODE_INVALID"), { code: "DATABASE_SSL_MODE_INVALID" });
    const status = await readMigrationStatus({ databaseUrl: env.DATABASE_URL, sslMode });
    console.log(JSON.stringify(status, null, 2));
    if (!status.compatible) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ...safeMigrationFailure(error), event: "migration.status.failed", readOnly: true }));
    process.exitCode = 1;
  }
}
