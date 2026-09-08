import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateRuntimeEnvironment } from "../scripts/preflight.mjs";
import { isRetryableMigrationError, loadMigrations, safeMigrationFailure, validateMigrationHistory } from "../scripts/migrate.mjs";

const healthy = {
  NODE_ENV: "production", DATABASE_URL: "postgres://portal:local-test@localhost:5432/portal",
  REDIS_URL: "redis://localhost:6379", PUBLIC_APP_URL: "https://portal.example.com",
  SESSION_PEPPER: "session-local-test-32-characters-or-more",
  OTP_PEPPER: "separate-local-test-32-characters-or-more",
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

test("production preflight accepts core configuration without optional SMS or storage", () => {
  const result = validateRuntimeEnvironment(healthy);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.warnings.some((issue) => issue.code === "ADMIN_ACCESS_DISABLED"));
});

test("preflight normalizes copied quotes and whitespace without exposing their contents", () => {
  assert.equal(validateRuntimeEnvironment({ ...healthy, DATABASE_URL: `  "${healthy.DATABASE_URL}"  ` }).ok, true);
  const result = validateRuntimeEnvironment({ ...healthy, DATABASE_URL: "secret-invalid-connection-url" });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("secret-invalid-connection-url"), false);
});

test("production requires HTTPS origin with no credentials, path or query", () => {
  for (const origin of ["http://portal.example.com", "https://u:p@portal.example.com", "https://portal.example.com/app", "https://portal.example.com/?secret=1", "https://portal.example.com/#hash"]) {
    assert.equal(validateRuntimeEnvironment({ ...healthy, PUBLIC_APP_URL: origin }).ok, false, origin);
  }
  assert.equal(validateRuntimeEnvironment({ ...healthy, NODE_ENV: "development", PUBLIC_APP_URL: "http://localhost:3000" }).ok, true);
});

test("preflight rejects weak, duplicate and example secrets and invalid encryption keys", () => {
  for (const changed of [
    { SESSION_PEPPER: "short" }, { OTP_PEPPER: healthy.SESSION_PEPPER },
    { SESSION_PEPPER: "REPLACE_WITH_GENERATED_SECRET_000000000" },
    { CONFIG_ENCRYPTION_KEY: "" }, { CONFIG_ENCRYPTION_KEY: Buffer.alloc(31).toString("base64") },
    { CONFIG_ENCRYPTION_KEY: "!" + healthy.CONFIG_ENCRYPTION_KEY }, { OTP_DEV_CODE: "123456" },
  ]) assert.equal(validateRuntimeEnvironment({ ...healthy, ...changed }).ok, false);
  assert.equal(validateRuntimeEnvironment({ ...healthy, CONFIG_ENCRYPTION_KEY: "a1".repeat(32) }).ok, true);
});

test("preflight rejects wrong connection protocols and invalid numeric limits", () => {
  for (const changed of [
    { DATABASE_URL: "https://database.example.com" }, { REDIS_URL: "https://redis.example.com" },
    { DATABASE_SSL_MODE: "false" }, { DB_POOL_MAX: "0" }, { TRUSTED_PROXY_HOPS: "6" },
    { PORT: "65536" }, { PORT: "3e3" }, { MIGRATION_WAIT_SECONDS: "0" },
  ]) assert.equal(validateRuntimeEnvironment({ ...healthy, ...changed }).ok, false);
});

test("partial object storage and wildcard administrator access cannot silently pass", () => {
  assert.equal(validateRuntimeEnvironment({ ...healthy, S3_BUCKET: "private" }).ok, false);
  assert.equal(validateRuntimeEnvironment({ ...healthy, ADMIN_IP_ALLOWLIST: "*" }).ok, false);
  assert.equal(validateRuntimeEnvironment({ ...healthy, ADMIN_IP_ALLOWLIST: "203.0.113.2,::1" }).ok, true);
  assert.equal(validateRuntimeEnvironment({ ...healthy, S3_ENDPOINT: "https://storage.example.com", S3_BUCKET: "private", S3_ACCESS_KEY_ID: "local-test-id", S3_SECRET_ACCESS_KEY: "local-test-key" }).ok, true);
});

test("migrations sort numerically and reject duplicate migration numbers", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".deployment-test-"));
  try {
    await writeFile(path.join(directory, "10_tenth.sql"), "select 10;");
    await writeFile(path.join(directory, "2_second.sql"), "select 2;");
    assert.deepEqual((await loadMigrations(directory)).map((migration) => migration.order), [2, 10]);
    await writeFile(path.join(directory, "02_duplicate.sql"), "select 2;");
    await assert.rejects(loadMigrations(directory), { code: "MIGRATION_NUMBER_INVALID" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("full migration history is checked before allowing pending migrations", async () => {
  const migrations = await loadMigrations();
  const history = migrations.map(({ name, checksum }) => ({ name, checksum }));
  assert.equal(validateMigrationHistory(migrations, history).length, 0);
  assert.equal(validateMigrationHistory(migrations, history.slice(0, 2)).length, migrations.length - 2);
  assert.throws(() => validateMigrationHistory(migrations, [{ ...history[0], checksum: "0".repeat(64) }]), { code: "MIGRATION_CHECKSUM_MISMATCH" });
  assert.throws(() => validateMigrationHistory(migrations, [{ name: "999_future.sql", checksum: "0".repeat(64) }]), { code: "MIGRATION_SOURCE_MISSING" });
  assert.throws(() => validateMigrationHistory(migrations, history.slice(1)), { code: "MIGRATION_HISTORY_GAP" });
});

test("only recoverable connection and lock errors are retried", () => {
  for (const code of ["ECONNREFUSED", "57P03", "55P03", "CONNECT_TIMEOUT"]) assert.equal(isRetryableMigrationError({ code }), true);
  for (const code of ["28P01", "42601", "42501", "MIGRATION_CHECKSUM_MISMATCH"]) assert.equal(isRetryableMigrationError({ code }), false);
  assert.equal(isRetryableMigrationError(new Error("secret password failed socket timeout")), false);
});

test("migration failure logging never serializes database error messages or query values", () => {
  const failure = safeMigrationFailure({ code: "28P01", message: "password local-test-secret rejected", detail: "postgres://u:secret@host/db", query: "select secret" });
  assert.deepEqual(failure, { event: "migration.failed", code: "28P01" });
});

test("production start rejects invalid configuration before trying migrations or starting HTTP", () => {
  const result = spawnSync(process.execPath, ["scripts/start.mjs"], {
    cwd: process.cwd(), timeout: 5000,
    env: { PATH: process.env.PATH, NODE_ENV: "production", DATABASE_URL: "private-invalid-url" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RUNTIME_CONFIGURATION|portal.preflight/);
  assert.equal(result.stderr.includes("private-invalid-url"), false);
  assert.equal(result.stdout.includes("migration.waiting"), false);
});

test("standalone startup cannot bypass production preflight with NODE_ENV=test", () => {
  const result = spawnSync(process.execPath, ["scripts/start.mjs"], {
    cwd: process.cwd(), timeout: 5000,
    env: { PATH: process.env.PATH, ...healthy, NODE_ENV: "test", PUBLIC_APP_URL: "http://localhost:3000" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PUBLIC_APP_URL/);
  assert.equal(result.stdout.includes("migration.waiting"), false);
});
