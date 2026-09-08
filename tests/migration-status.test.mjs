import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { loadMigrations } from "../scripts/migrate.mjs";
import { buildMigrationStatus, summarizeMigrationHistory } from "../scripts/migration-status.mjs";
import { loadSchemaContract } from "../scripts/migration-compatibility.mjs";

test("status identifies the reported 005_workspace.sql incident without hiding canonical verification", async () => {
  const migrations = await loadMigrations();
  const history = migrations.map(({ name, checksum }) => ({ name, checksum }));
  history.push({ name: "005_workspace.sql", checksum: "a".repeat(64) });
  const before = structuredClone(history);
  const status = summarizeMigrationHistory(migrations, history);
  assert.equal(status.compatible, false);
  assert.equal(status.pendingCount, 0);
  assert.deepEqual(status.issues, [{ code: "MIGRATION_SOURCE_MISSING", file: "005_workspace.sql" }]);
  assert.equal(status.sourceFiles.every((file) => file.status === "applied"), true);
  assert.equal(status.missingSources[0].recordedChecksum, "a".repeat(64));
  assert.deepEqual(history, before, "diagnostics must not mutate historical evidence");
});

test("status reports checksum changes even when an unknown history row is also present", async () => {
  const migrations = await loadMigrations();
  const history = migrations.map(({ name, checksum }) => ({ name, checksum }));
  history[0].checksum = "b".repeat(64);
  history.unshift({ name: "005_workspace.sql", checksum: "a".repeat(64) });
  const status = summarizeMigrationHistory(migrations, history);
  assert.equal(status.compatible, false);
  assert.ok(status.issues.some((issue) => issue.code === "MIGRATION_CHECKSUM_MISMATCH" && issue.file === migrations[0].name));
  assert.ok(status.issues.some((issue) => issue.code === "MIGRATION_SOURCE_MISSING"));
});

test("status surfaces exact matching source content without silently accepting a rename", async () => {
  const migrations = await loadMigrations();
  const canonical = migrations.find((migration) => migration.order === 5);
  const history = migrations.filter((migration) => migration.order <= 4).map(({ name, checksum }) => ({ name, checksum }));
  history.push({ name: "005_workspace.sql", checksum: canonical.checksum });
  const status = summarizeMigrationHistory(migrations, history);
  assert.deepEqual(status.missingSources[0].matchingBundledSources, [canonical.name]);
  assert.equal(status.compatible, false);
  assert.equal(status.action, "RESTORE_ORIGINAL_MIGRATION_SOURCES");
});

test("status distinguishes empty database, pending suffix, history gaps and duplicate history", async () => {
  const migrations = await loadMigrations();
  assert.equal(summarizeMigrationHistory(migrations, []).compatible, true);
  const history = migrations.slice(0, 3).map(({ name, checksum }) => ({ name, checksum }));
  assert.equal(summarizeMigrationHistory(migrations, history).pendingCount, migrations.length - 3);
  assert.ok(summarizeMigrationHistory(migrations, history.slice(1)).issues.some((issue) => issue.code === "MIGRATION_HISTORY_GAP"));
  assert.ok(summarizeMigrationHistory(migrations, [...history, history[0]]).issues.some((issue) => issue.code === "MIGRATION_HISTORY_DUPLICATE"));
});

test("status failure does not log supplied invalid connection values", () => {
  const result = spawnSync(process.execPath, ["scripts/migration-status.mjs"], {
    cwd: process.cwd(), timeout: 5000, encoding: "utf8",
    env: { PATH: process.env.PATH, DATABASE_URL: "private-invalid-database-secret" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DATABASE_URL_INVALID/);
  assert.equal(result.stderr.includes("private-invalid-database-secret"), false);
});

test("status uses the same verified compatibility policy as startup and still identifies unavailable source", async () => {
  const migrations = await loadMigrations();
  const history = [...migrations.map(({ name, checksum }) => ({ name, checksum })), { name: "005_workspace.sql", checksum: "a".repeat(64) }];
  const { schema } = await loadSchemaContract();
  const ready = await buildMigrationStatus(migrations, history, schema);
  assert.equal(ready.compatible, true);
  assert.equal(ready.compatibility.sourceUnavailable, true);
  assert.equal(ready.missingSources[0].file, "005_workspace.sql");
  assert.equal(ready.action, "NONE");
  const changed = structuredClone(schema);
  changed.triggers = [];
  const blocked = await buildMigrationStatus(migrations, history, changed);
  assert.equal(blocked.compatible, false);
  assert.equal(blocked.compatibility.code, "MIGRATION_SCHEMA_INCOMPATIBLE");
  assert.ok(blocked.compatibility.schemaIssues.length > 0);
});
