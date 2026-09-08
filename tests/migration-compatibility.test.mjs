import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { applyMigrationTransaction, loadMigrations } from "../scripts/migrate.mjs";
import { compareSchemaContract, loadSchemaContract, readSchemaSnapshot, verifyDatabaseCompatibility } from "../scripts/migration-compatibility.mjs";

const legacyRow = { name: "005_workspace.sql", checksum: "a".repeat(64) };
const completeHistory = (migrations) => [...migrations.map(({ name, checksum }) => ({ name, checksum })), legacyRow];

test("legacy compatibility retains the unavailable source as evidence only after complete canonical verification", async () => {
  const migrations = await loadMigrations();
  const history = completeHistory(migrations);
  const original = structuredClone(history);
  const contract = await loadSchemaContract();
  const warning = await verifyDatabaseCompatibility(migrations, history, async () => contract.schema);
  assert.equal(warning.event, "migration.compatibility_verified");
  assert.equal(warning.sourceUnavailable, true);
  assert.equal(warning.historyChanged, false);
  assert.equal(warning.applied, 0);
  assert.deepEqual(history, original);
});

test("compatibility rejects corrupt history and altered hashes before reading the schema", async () => {
  const migrations = await loadMigrations();
  let schemaReads = 0;
  const readSchema = async () => { schemaReads += 1; return (await loadSchemaContract()).schema; };
  const cases = [
    [completeHistory(migrations).map((row, i) => i === 0 ? { ...row, checksum: "b".repeat(64) } : row), "MIGRATION_CHECKSUM_MISMATCH"],
    [[...completeHistory(migrations), legacyRow], "MIGRATION_HISTORY_DUPLICATE"],
    [completeHistory(migrations).map((row) => row.name === legacyRow.name ? { ...row, checksum: "invalid" } : row), "MIGRATION_HISTORY_INVALID"],
  ];
  for (const [history, code] of cases) await assert.rejects(verifyDatabaseCompatibility(migrations, history, readSchema), { code });
  assert.equal(schemaReads, 0, "historical verification must precede schema reads");
});

test("new releases cannot silently inherit the legacy compatibility exception", async () => {
  const migrations = await loadMigrations();
  const next = [...migrations, { name: "008_future.sql", checksum: "f".repeat(64), order: 8, source: "select 1;" }];
  await assert.rejects(verifyDatabaseCompatibility(next, completeHistory(next), async () => assert.fail("must not read schema")), { code: "MIGRATION_BASELINE_RELEASE_UNSUPPORTED" });
});

test("schema contract rejects missing ownership, identity, quota and audit protections", async () => {
  const { schema } = await loadSchemaContract();
  for (const [section, find] of [
    ["columns", (row) => row.table_name === "messages" && row.column_name === "user_id"],
    ["constraints", (row) => row.table_name === "usage_ledger" && row.kind === "c"],
    ["indexes", (row) => row.name === "messages_user_turn_uniq"],
    ["triggers", (row) => row.name === "admin_audit_logs_append_only"],
    ["functions", (row) => row.name === "portal_release_stale_reservations"],
  ]) {
    const changed = structuredClone(schema);
    const index = changed[section].findIndex(find);
    assert.notEqual(index, -1);
    changed[section].splice(index, 1);
    assert.equal(compareSchemaContract(schema, changed).ok, false, section);
  }
  const changed = structuredClone(schema);
  changed.tables.find((row) => row.table_name === "users").row_security = true;
  assert.equal(compareSchemaContract(schema, changed).ok, false);
});

test("schema contract permits harmless extensions but rejects unreviewed write constraints", async () => {
  const { schema } = await loadSchemaContract();
  const changed = structuredClone(schema);
  changed.columns.push({ table_name: "conversations", column_name: "workspace_label", data_type: "text", not_null: false, default_expression: null });
  assert.equal(compareSchemaContract(schema, changed).ok, true);
  changed.columns.at(-1).not_null = true;
  assert.equal(compareSchemaContract(schema, changed).ok, false);
});

// Optional real SQL integration without a server or production credentials.
// Install PGlite in an isolated directory, then set TEST_PGLITE_ROOT to its
// node_modules/@electric-sql/pglite folder. It is never a runtime dependency.
const pgliteRoot = process.env.TEST_PGLITE_ROOT;
test("real PostgreSQL executes canonical upgrade and verifies legacy restart without writes", { skip: !pgliteRoot, timeout: 120000 }, async (t) => {
  const { PGlite } = await import(pathToFileURL(path.join(pgliteRoot, "dist/index.js")).href);
  const { pgcrypto } = await import(pathToFileURL(path.join(pgliteRoot, "dist/contrib/pgcrypto.js")).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  const migrations = await loadMigrations();
  const adapter = (client, calls = []) => {
    const tx = async (strings, ...values) => {
      const source = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
      calls.push(source);
      return (await client.query(source, values)).rows;
    };
    tx.unsafe = async (source) => {
      calls.push(source);
      const results = await client.exec(source);
      return results.at(-1)?.rows || [];
    };
    return tx;
  };
  try {
    await db.waitReady;
    const first = await db.transaction((client) => applyMigrationTransaction(adapter(client), migrations));
    assert.equal(first.appliedNames.length, 7);
    await db.query("insert into users(phone_e164,username) values ($1,$2)", ["+989121234567", "RegressionUser"]);
    await db.query("update runtime_models set display_name=$1 where alias='sirius'", ["Administrator customized model"]);
    await db.query("insert into schema_migrations(name,checksum) values ($1,$2)", [legacyRow.name, legacyRow.checksum]);
    await db.query("insert into schema_migrations(name,checksum) values ($1,$2)", ["007_security_identity.sql", "d".repeat(64)]);
    await db.query("insert into schema_migrations(name,checksum) values ($1,$2)", ["011_historical_notes.sql", "e".repeat(64)]);
    const beforeHistory = (await db.query("select * from schema_migrations order by name")).rows;
    const beforeUsers = (await db.query("select * from users order by id")).rows;
    const beforeModels = (await db.query("select * from runtime_models order by alias")).rows;
    const calls = [];
    await t.test("reported legacy row starts twice and never mutates schema, history, users or model configuration", async () => {
      for (let i = 0; i < 2; i += 1) {
        const result = await db.transaction((client) => applyMigrationTransaction(adapter(client, calls), migrations));
        assert.deepEqual(result.appliedNames, []);
        assert.equal(result.warning.sourceUnavailable, true);
      }
      assert.equal(calls.some((source) => /^\s*(insert|update|delete|create|alter|drop)\b/i.test(source)), false);
      assert.deepEqual((await db.query("select * from schema_migrations order by name")).rows, beforeHistory);
      assert.deepEqual((await db.query("select * from users order by id")).rows, beforeUsers);
      assert.deepEqual((await db.query("select * from runtime_models order by alias")).rows, beforeModels);
    });
    for (const [name, source] of [
      ["a canonical filename absent in an alternate lineage", "delete from schema_migrations where name='005_provider_base_url_from_environment.sql'"],
      ["all canonical names absent in an alternate lineage", "delete from schema_migrations where name not in ('005_workspace.sql','007_security_identity.sql','011_historical_notes.sql')"],
      ["unversioned compatible schema", "drop table schema_migrations"],
      ["equivalent renamed uniqueness", "alter index messages_user_turn_uniq rename to legacy_message_turn_unique"],
    ]) await t.test(name + " is checked without replay or invented history", async () => {
      const rollback = new Error("ROLLBACK_COMPATIBILITY_CASE");
      await assert.rejects(db.transaction(async (client) => {
        await client.exec(source);
        const calls = [];
        const result = await applyMigrationTransaction(adapter(client, calls), migrations);
        assert.equal(result.warning.schemaVerified, true);
        assert.deepEqual(result.appliedNames, []);
        assert.equal(calls.some((sql) => /^\s*(insert|update|delete|create|alter|drop)\b/i.test(sql)), false);
        assert.deepEqual((await client.query("select * from users order by id")).rows, beforeUsers);
        assert.deepEqual((await client.query("select * from runtime_models order by alias")).rows, beforeModels);
        throw rollback;
      }), (error) => error === rollback);
    });
    for (const [name, source, code] of [
      ["changed canonical checksum", "update schema_migrations set checksum=repeat('b',64) where name='001_initial.sql'", "MIGRATION_CHECKSUM_MISMATCH"],
      ["removed turn uniqueness", "drop index messages_user_turn_uniq", "MIGRATION_SCHEMA_INCOMPATIBLE"],
      ["disabled audit trigger", "alter table admin_audit_logs disable trigger admin_audit_logs_append_only", "MIGRATION_SCHEMA_INCOMPATIBLE"],
      ["removed free plan", "delete from plans where code='free'", "MIGRATION_SCHEMA_INCOMPATIBLE"],
      ["weakened quota constraint", "alter table usage_ledger drop constraint usage_ledger_reserved_cost_micro_usd_check", "MIGRATION_SCHEMA_INCOMPATIBLE"],
    ]) await t.test(name + " fails closed", async () => {
      const rollback = new Error("ROLLBACK_TEST_CASE");
      await assert.rejects(db.transaction(async (client) => {
        await client.exec(source);
        await assert.rejects(applyMigrationTransaction(adapter(client), migrations), { code });
        throw rollback;
      }), (error) => error === rollback);
    });
    const { schema } = await loadSchemaContract();
    assert.equal(compareSchemaContract(schema, await readSchemaSnapshot(async (source) => (await db.query(source)).rows)).ok, true);
    console.log("SQL engine:", (await db.query("select version() as version")).rows[0].version);
  } finally { await db.close(); }
});
