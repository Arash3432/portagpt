import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations } from "../scripts/migrate.mjs";
import { loadSchemaContract, verifyDatabaseCompatibility } from "../scripts/migration-compatibility.mjs";
import { buildMigrationStatus } from "../scripts/migration-status.mjs";
import { migrationReportEvents, reportStartupFailure } from "../scripts/migration-report.mjs";

test("both reported missing filenames and arbitrary historical names use one schema verification path", async () => {
  const migrations = await loadMigrations();
  const { schema } = await loadSchemaContract();
  const extra = ["005_workspace.sql", "007_security_identity.sql", "012_old_release.sql"].map((name) => ({ name, checksum: "a".repeat(64) }));
  const history = [...migrations.map(({ name, checksum }) => ({ name, checksum })), ...extra];
  const warning = await verifyDatabaseCompatibility(migrations, history, async () => schema);
  assert.deepEqual(warning.retainedSources, extra.map((row) => row.name));
  assert.equal(warning.canonicalHistoryComplete, true);
  assert.equal(warning.historyChanged, false);
  assert.equal(warning.applied, 0);
  const sparse = await verifyDatabaseCompatibility(migrations, extra, async () => schema);
  assert.equal(sparse.canonicalHistoryComplete, false);
  assert.equal(sparse.unrecordedSources.length, 7);
  assert.equal(sparse.historyChanged, false);
});

test("a complete automatic report includes all historical and schema conflicts in one run", async () => {
  const migrations = await loadMigrations();
  const history = migrations.map(({ name, checksum }) => ({ name, checksum }));
  history[0].checksum = "b".repeat(64);
  history[2].checksum = "c".repeat(64);
  history.push({ name: "005_workspace.sql", checksum: "d".repeat(64) }, { name: "007_security_identity.sql", checksum: "e".repeat(64) });
  const { schema } = await loadSchemaContract();
  const changed = structuredClone(schema);
  changed.triggers = [];
  changed.columns = changed.columns.filter((row) => row.column_name !== "username");
  const report = await buildMigrationStatus(migrations, history, changed);
  assert.equal(report.compatible, false);
  assert.equal(report.issues.filter((issue) => issue.code === "MIGRATION_CHECKSUM_MISMATCH").length, 2);
  assert.equal(report.missingSources.length, 2);
  assert.ok(report.schemaIssues.some((issue) => issue.object === "users.username"));
  assert.ok(report.schemaIssues.some((issue) => issue.section === "triggers"));
  const events = [];
  assert.equal(await reportStartupFailure({ code: "MIGRATION_CHECKSUM_MISMATCH" }, { readStatus: async () => report, log: (event) => events.push(event) }), true);
  assert.equal(events.filter((event) => event.event === "migration.report.external_source").length, 2);
  assert.equal(events.at(-1).event, "migration.report.complete");
});

test("diagnostics never log connection values, SQL, user data or unsafe identifiers", async () => {
  const events = migrationReportEvents({
    compatible: false, password: "do-not-print-secret", query: "select private_password",
    sourceFiles: [{ file: "https://u:do-not-print-secret@host/evil.sql", status: "unknown", recordedChecksum: "do-not-print-secret" }],
    schemaIssues: [{ section: "columns", object: "secret\nvalue", reason: "definition_mismatch", definition: "do-not-print-secret" }],
  });
  assert.equal(JSON.stringify(events).includes("do-not-print-secret"), false);
  assert.equal(JSON.stringify(events).includes("private_password"), false);
  const logged = [];
  await reportStartupFailure({ code: "MIGRATION_SCHEMA_INCOMPATIBLE" }, {
    readStatus: async () => { throw Object.assign(new Error("postgres://u:do-not-print-secret@host/db"), { code: "28P01" }); },
    log: (event) => logged.push(event),
  });
  assert.deepEqual(logged, [{ event: "migration.report.failed", readOnly: true, code: "28P01" }]);
});

test("invalid environment and connection failures do not trigger extra diagnostic database retries", async () => {
  for (const code of ["RUNTIME_CONFIGURATION_INVALID", "28P01", "ECONNREFUSED"]) {
    assert.equal(await reportStartupFailure({ code }, { readStatus: () => assert.fail("must not connect") }), false);
  }
});
