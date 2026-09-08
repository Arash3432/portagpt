import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { applyMigrations } from "../scripts/migrate.mjs";

// Isolated optional test tools; neither package belongs in production.
const pgRoot = process.env.TEST_PGLITE_ROOT;
const socketRoot = process.env.TEST_PGLITE_SOCKET_ROOT;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsonEvents = (output) => output.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });

test("production startup over PostgreSQL wire protocol resumes compatible branches and logs all incompatible metadata", { skip: !pgRoot || !socketRoot, timeout: 60000 }, async (t) => {
  await access(".next/standalone/scripts/start.mjs");
  const { PGlite } = await import(pathToFileURL(path.join(pgRoot, "dist/index.js")).href);
  const { pgcrypto } = await import(pathToFileURL(path.join(pgRoot, "dist/contrib/pgcrypto.js")).href);
  const { PGLiteSocketServer } = await import(pathToFileURL(path.join(socketRoot, "dist/index.js")).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  const socket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 55439, maxConnections: 4 });
  await socket.start();
  const databaseUrl = "postgres://postgres:fixture-password@127.0.0.1:55439/postgres";
  const children = new Set();
  const start = (script = ".next/standalone/scripts/start.mjs") => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH, NODE_ENV: "production", PORT: "3331", PUBLIC_APP_URL: "https://portal.example.test",
        DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable", DB_POOL_MAX: "2",
        REDIS_URL: "redis://127.0.0.1:56388", PORTAL_IMAGE_WORKER_EAGER_START: "false",
        SESSION_PEPPER: "fixture-session-pepper-12345678901234567890",
        OTP_PEPPER: "fixture-distinct-otp-pepper-1234567890123456",
        CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const exited = once(child, "exit");
    children.add(child);
    return { child, output: () => output, exited };
  };
  const stop = async (run) => {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGTERM");
    await run.exited;
    children.delete(run.child);
  };
  try {
    const fresh = await applyMigrations({ databaseUrl, log: () => {} });
    assert.equal(fresh.applied, 7, "unchanged canonical SQL installs through the real postgres client");
    await db.query("insert into users(phone_e164,username) values ($1,$2)", ["+989121234567", "PreservedUser"]);
    await db.query("update runtime_models set display_name=$1 where alias='sirius'", ["Preserved administrator model"]);
    for (const name of ["005_workspace.sql", "007_security_identity.sql", "011_legacy_release.sql"]) {
      await db.query("insert into schema_migrations(name,checksum) values ($1,$2)", [name, "a".repeat(64)]);
    }
    const beforeHistory = (await db.query("select * from schema_migrations order by name")).rows;
    const beforeUsers = (await db.query("select * from users order by id")).rows;
    const beforeModels = (await db.query("select * from runtime_models order by alias")).rows;

    if (process.env.TEST_PREVIOUS_START_SCRIPT) await t.test("previous startup reproduces the reported missing security identity failure", async () => {
      const run = start(process.env.TEST_PREVIOUS_START_SCRIPT);
      const [code] = await run.exited;
      assert.equal(code, 1);
      assert.ok(jsonEvents(run.output()).some((event) => event.event === "portal.start.failed" && event.file === "007_security_identity.sql"));
      children.delete(run.child);
    });

    await t.test("current standalone starts twice and serves the app while preserving history and configuration", async () => {
      for (let restart = 0; restart < 2; restart += 1) {
        const run = start();
        for (let attempt = 0; ; attempt += 1) {
          if (run.child.exitCode !== null) assert.fail(run.output());
          try {
            const response = await fetch("http://127.0.0.1:3331/", { signal: AbortSignal.timeout(500) });
            if (response.ok) break;
          } catch {}
          if (attempt > 120) assert.fail("production server did not become ready: " + run.output());
          await wait(75);
        }
        const health = await fetch("http://127.0.0.1:3331/api/health", { signal: AbortSignal.timeout(10000) });
        assert.equal(health.status, 200);
        const body = await health.json();
        assert.equal(body.version, "1.7.1");
        assert.equal(body.database, "ok");
        const events = jsonEvents(run.output());
        assert.ok(events.some((event) => event.event === "migration.compatibility_verified" && event.schemaVerified));
        assert.ok(events.some((event) => event.event === "migration.ready" && event.applied === 0));
        await stop(run);
      }
      assert.deepEqual((await db.query("select * from schema_migrations order by name")).rows, beforeHistory);
      assert.deepEqual((await db.query("select * from users order by id")).rows, beforeUsers);
      assert.deepEqual((await db.query("select * from runtime_models order by alias")).rows, beforeModels);
    });

    await t.test("failed boot automatically reports all missing sources and both schema problems without terminal access", async () => {
      await db.exec("alter table users drop column username; alter table admin_audit_logs disable trigger admin_audit_logs_append_only;");
      const run = start();
      const [code] = await run.exited;
      assert.equal(code, 1);
      const events = jsonEvents(run.output());
      assert.ok(events.some((event) => event.event === "migration.report.summary" && event.missingSourceCount === 3));
      assert.ok(events.some((event) => event.event === "migration.report.external_source" && event.file === "007_security_identity.sql"));
      assert.ok(events.some((event) => event.event === "migration.report.schema_issue" && event.object === "users.username"));
      assert.ok(events.some((event) => event.event === "migration.report.schema_issue" && event.object === "admin_audit_logs.admin_audit_logs_append_only"));
      assert.ok(events.some((event) => event.event === "migration.report.complete"));
      assert.equal(run.output().includes("fixture-password"), false);
      assert.equal(run.output().includes("+989121234567"), false);
      assert.deepEqual((await db.query("select * from schema_migrations order by name")).rows, beforeHistory);
      children.delete(run.child);
    });
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await socket.stop();
    await db.close();
  }
});
