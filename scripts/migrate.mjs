import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postgres from "postgres";
import { normalizeEnvironment } from "./preflight.mjs";
import { readSchemaSnapshot, verifyDatabaseCompatibility } from "./migration-compatibility.mjs";
import { inspectMigrationHistory } from "./migration-history.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const RETRYABLE_CODES = new Set(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECT_TIMEOUT", "57P01", "57P02", "57P03", "55P03"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const migrationError = (code, file) => Object.assign(new Error(code), { code, ...(file ? { file } : {}) });

export function isRetryableMigrationError(error) {
  return Boolean(error && typeof error === "object" && RETRYABLE_CODES.has(error.code));
}

export function safeMigrationFailure(error) {
  const code = error && typeof error === "object" && typeof error.code === "string" && /^[A-Z0-9_]{2,80}$/.test(error.code)
    ? error.code : "MIGRATION_FAILED";
  return { event: "migration.failed", code,
    ...(error?.file && /^\d+_[a-z0-9_-]+\.sql$/i.test(error.file) ? { file: error.file } : {}),
    ...(/^MIGRATION_(SOURCE_MISSING|BASELINE_|SCHEMA_|HISTORY_|CHECKSUM_)/.test(code)
      ? { action: "READ_AUTOMATIC_MIGRATION_REPORT" } : {}) };
}

export async function loadMigrations(directory = path.join(projectRoot, "migrations")) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).map((entry) => entry.name);
  if (!files.length) throw migrationError("MIGRATIONS_MISSING");
  const seen = new Set();
  const migrations = [];
  for (const name of files) {
    const match = /^(\d+)_([a-z0-9_-]+)\.sql$/i.exec(name);
    if (!match) throw migrationError("MIGRATION_FILENAME_INVALID");
    const order = Number(match[1]);
    if (!Number.isSafeInteger(order) || order < 1 || seen.has(order)) throw migrationError("MIGRATION_NUMBER_INVALID", name);
    seen.add(order);
    const source = await readFile(path.join(directory, name), "utf8");
    migrations.push({ name, order, source, checksum: createHash("sha256").update(source).digest("hex") });
  }
  return migrations.sort((a, b) => a.order - b.order);
}

export function validateMigrationHistory(migrations, applied) {
  const inspected = inspectMigrationHistory(migrations, applied);
  if (inspected.integrityIssues.length) throw Object.assign(migrationError(inspected.integrityIssues[0].code, inspected.integrityIssues[0].file), { historyIssues: inspected.integrityIssues });
  const known = new Map(migrations.map((migration) => [migration.name, migration]));
  const history = new Map();
  for (const row of applied) {
    if (!known.has(row.name)) throw migrationError("MIGRATION_SOURCE_MISSING", row.name);
    if (history.has(row.name)) throw migrationError("MIGRATION_HISTORY_DUPLICATE", row.name);
    if (row.checksum?.trim() !== known.get(row.name).checksum) throw migrationError("MIGRATION_CHECKSUM_MISMATCH", row.name);
    history.set(row.name, row);
  }
  // Validate the complete history before executing anything. Never replay an
  // old migration after a later migration has already changed the schema.
  let pendingSeen = false;
  for (const migration of migrations) {
    if (!history.has(migration.name)) pendingSeen = true;
    else if (pendingSeen) throw migrationError("MIGRATION_HISTORY_GAP", migration.name);
  }
  return migrations.filter((migration) => !history.has(migration.name));
}

export async function applyMigrationTransaction(tx, migrations) {
  await tx`set local lock_timeout = '15s'`;
  await tx`set local statement_timeout = '120s'`;
  await tx`select pg_advisory_xact_lock(731905114)`;
  const [{ history_table: historyTable }] = await tx`select to_regclass('schema_migrations')::text as history_table`;
  const applied = historyTable ? await tx`select name, checksum from schema_migrations` : [];
  const inspected = inspectMigrationHistory(migrations, applied);
  if (inspected.integrityIssues.length) throw Object.assign(migrationError(inspected.integrityIssues[0].code, inspected.integrityIssues[0].file), { historyIssues: inspected.integrityIssues });
  let existingSchemaWithoutHistory = false;
  if (!applied.length) {
    const [row] = await tx`select exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname=current_schema() and c.relname in ('users','conversations','messages','plans')
    ) as application_schema_exists`;
    existingSchemaWithoutHistory = row.application_schema_exists;
  }
  if (inspected.needsBaseline || existingSchemaWithoutHistory) {
    // Existing installations can have a different historical file lineage.
    // Verify the full runtime schema and known hashes without replaying SQL or
    // inserting invented history. Every external filename follows one policy.
    const warning = await verifyDatabaseCompatibility(migrations, applied,
      () => readSchemaSnapshot((source) => tx.unsafe(source)));
    return { appliedNames: [], warning };
  }
  if (!historyTable) {
    await tx`create table schema_migrations (
      name text primary key,
      checksum char(64) not null,
      applied_at timestamptz not null default now()
    )`;
  }
  const pending = validateMigrationHistory(migrations, applied);
  for (const migration of pending) {
    await tx.unsafe(migration.source);
    await tx`insert into schema_migrations(name, checksum) values(${migration.name}, ${migration.checksum})`;
  }
  return { appliedNames: pending.map((migration) => migration.name) };
}

export async function applyMigrations({ databaseUrl, sslMode = "disable", directory, connection = {}, log = (value) => console.log(JSON.stringify(value)) } = {}) {
  const migrations = await loadMigrations(directory);
  const sql = postgres(databaseUrl, {
    max: 1, ssl: sslMode === "require" ? "require" : false, prepare: false,
    connect_timeout: 10, max_lifetime: null, onnotice: () => {}, connection,
  });
  try {
    // Lock before the tracking table's first creation. The schema changes and
    // history commit together; a disconnect automatically releases this lock.
    const result = await sql.begin((tx) => applyMigrationTransaction(tx, migrations));
    const { appliedNames, warning } = result;
    if (warning) log(warning);
    for (const file of appliedNames) log({ event: "migration.applied", file });
    log({ event: "migration.ready", applied: appliedNames.length, total: migrations.length });
    return { applied: appliedNames.length, total: migrations.length };
  } finally { await sql.end({ timeout: 5 }); }
}

export async function runMigrations(raw = process.env) {
  const env = normalizeEnvironment(raw);
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw migrationError("DATABASE_URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw migrationError("DATABASE_URL_INVALID");
  const sslMode = env.DATABASE_SSL_MODE || "disable";
  if (!["disable", "require"].includes(sslMode)) throw migrationError("DATABASE_SSL_MODE_INVALID");
  const waitSeconds = Number(env.MIGRATION_WAIT_SECONDS || 90);
  if (!Number.isInteger(waitSeconds) || waitSeconds < 10 || waitSeconds > 300) throw migrationError("MIGRATION_WAIT_SECONDS_INVALID");
  const deadline = Date.now() + waitSeconds * 1000;
  for (let attempt = 1; ; attempt += 1) {
    try { return await applyMigrations({ databaseUrl: env.DATABASE_URL, sslMode }); }
    catch (error) {
      if (!isRetryableMigrationError(error) || Date.now() >= deadline) throw error;
      console.warn(JSON.stringify({ event: "migration.waiting", code: error.code, attempt }));
      await sleep(Math.min(3_000, Math.max(0, deadline - Date.now())));
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await runMigrations(); }
  catch (error) { console.error(JSON.stringify(safeMigrationFailure(error))); process.exitCode = 1; }
}
