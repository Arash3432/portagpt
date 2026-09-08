import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertRuntimeEnvironment, normalizeEnvironment } from "./preflight.mjs";
import { runMigrations, safeMigrationFailure } from "./migrate.mjs";
import { readMigrationStatus } from "./migration-status.mjs";
import { reportStartupFailure } from "./migration-report.mjs";

// Migrations and Next run in the same process, so SIGTERM reaches Next directly.
try {
  for (const [key, value] of Object.entries(normalizeEnvironment(process.env))) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  // The generated standalone server always sets production. Validate that same
  // mode here so a stale NODE_ENV=test cannot bypass production preflight.
  process.env.NODE_ENV = "production";
  process.env.PORT ||= "3000";
  process.env.HOSTNAME = "0.0.0.0";
  const preflight = assertRuntimeEnvironment();
  console.log(JSON.stringify({ event: "portal.preflight", ...preflight }));
  let server = new URL("../server.js", import.meta.url);
  try { await access(server); }
  catch { server = new URL("../.next/standalone/server.js", import.meta.url); await access(server); }
  await runMigrations();
  process.chdir(fileURLToPath(new URL("./", server)));
  await import(server.href);
} catch (error) {
  console.error(JSON.stringify(error?.code === "RUNTIME_CONFIGURATION_INVALID"
    ? { event: "portal.preflight", ok: false, issues: error.issues }
    : { ...safeMigrationFailure(error), event: "portal.start.failed" }));
  // This runs automatically while the database is reachable, even if the web
  // server/terminal never opened. Reads use their own bounded read-only tx.
  await reportStartupFailure(error, { readStatus: () => readMigrationStatus({
    databaseUrl: process.env.DATABASE_URL, sslMode: process.env.DATABASE_SSL_MODE || "disable",
  }) });
  process.exitCode = 1;
}
