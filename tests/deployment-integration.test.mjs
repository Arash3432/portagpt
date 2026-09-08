import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import postgres from "postgres";
import { applyMigrations } from "../scripts/migrate.mjs";

// Use a disposable test database. Every case owns a random schema and drops
// only that schema; no production database should be supplied to test commands.
const databaseUrl = process.env.TEST_DATABASE_URL;

async function fixture(run) {
  const schema = `portal_migration_test_${randomBytes(8).toString("hex")}`;
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const directory = await mkdtemp(path.join(process.cwd(), ".deployment-test-"));
  try {
    await sql`create schema ${sql(schema)}`;
    const options = { databaseUrl, directory, connection: { search_path: schema }, log: () => {} };
    await run({ sql, schema, directory, options });
  } finally {
    await sql`drop schema if exists ${sql(schema)} cascade`;
    await sql.end({ timeout: 5 });
    await rm(directory, { recursive: true, force: true });
  }
}

test("concurrent first boots serialize schema creation and remain idempotent", { skip: !databaseUrl, timeout: 20000 }, async () => {
  await fixture(async ({ directory, options, sql, schema }) => {
    await writeFile(path.join(directory, "001_start.sql"), "create table migration_probe (id integer primary key); insert into migration_probe values (1); select pg_sleep(0.15);");
    await writeFile(path.join(directory, "002_second.sql"), "insert into migration_probe values (2);");
    const results = await Promise.all([applyMigrations(options), applyMigrations(options)]);
    assert.deepEqual(results.map((result) => result.applied).sort(), [0, 2]);
    assert.equal((await sql`select count(*)::integer as count from ${sql(schema + ".migration_probe")}`)[0].count, 2);
    assert.equal((await applyMigrations(options)).applied, 0);
  });
});

test("a failed pending migration rolls back schema and migration history together", { skip: !databaseUrl, timeout: 20000 }, async () => {
  await fixture(async ({ directory, options, sql, schema }) => {
    await writeFile(path.join(directory, "001_start.sql"), "create table migration_probe (id integer primary key);");
    await writeFile(path.join(directory, "002_broken.sql"), "insert into migration_probe values (1); select * from table_that_does_not_exist;");
    await assert.rejects(applyMigrations(options), { code: "42P01" });
    const tables = await sql`select table_name from information_schema.tables where table_schema = ${schema}`;
    assert.equal(tables.length, 0);
    await writeFile(path.join(directory, "002_broken.sql"), "insert into migration_probe values (1);");
    assert.equal((await applyMigrations(options)).applied, 2);
  });
});

test("changed history prevents any pending migration from executing", { skip: !databaseUrl, timeout: 20000 }, async () => {
  await fixture(async ({ directory, options, sql, schema }) => {
    await writeFile(path.join(directory, "001_start.sql"), "create table migration_probe (id integer primary key);");
    await applyMigrations(options);
    await writeFile(path.join(directory, "001_start.sql"), "create table migration_probe (id bigint primary key);");
    await writeFile(path.join(directory, "002_pending.sql"), "insert into migration_probe values (1);");
    await assert.rejects(applyMigrations(options), { code: "MIGRATION_CHECKSUM_MISMATCH" });
    assert.equal((await sql`select count(*)::integer as count from ${sql(schema + ".migration_probe")}`)[0].count, 0);
    assert.equal((await sql`select count(*)::integer as count from ${sql(schema + ".schema_migrations")}`)[0].count, 1);
  });
});
