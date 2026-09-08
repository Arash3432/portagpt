#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node --input-type=module - "${project_root}" <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2];
const required = [
  ".next/BUILD_ID", ".next/standalone/server.js", ".next/standalone/.next/BUILD_ID",
  ".next/standalone/scripts/start.mjs", ".next/standalone/scripts/preflight.mjs",
  ".next/standalone/scripts/migrate.mjs", ".next/standalone/node_modules/postgres/package.json",
  ".next/standalone/scripts/migration-compatibility.mjs", ".next/standalone/scripts/migration-status.mjs",
  ".next/standalone/scripts/migration-schema-contract.json",
  ".next/standalone/scripts/migration-history.mjs", ".next/standalone/scripts/migration-report.mjs",
  "Dockerfile", "liara.json", ".env.example", "GENERATE-SECRETS.html", "START-HERE.md",
  "ADMIN-GUIDE.md", "SECURITY.md", "README.md", "LIARA-DEPLOYMENT.md",
];
for (const file of required) await access(join(root, file));
const liara = JSON.parse(await readFile(join(root, "liara.json"), "utf8"));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const deployedPkg = JSON.parse(await readFile(join(root, ".next/standalone/package.json"), "utf8"));
assert.equal(liara.platform, "docker");
assert.equal(liara.port, 3000);
assert.equal(pkg.scripts.start, "node scripts/start.mjs");
assert.match(pkg.scripts.build, /prepare-standalone/);
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[""].version);
assert.equal(pkg.version, deployedPkg.version);
assert.ok(liara.healthCheck.command.includes("AbortSignal.timeout"));
assert.ok(liara.healthCheck.startPeriod >= 90);
for (const script of ["start.mjs", "preflight.mjs", "migrate.mjs", "migration-compatibility.mjs", "migration-history.mjs", "migration-report.mjs", "migration-status.mjs", "migration-schema-contract.json"]) {
  assert.equal(
    await readFile(join(root, "scripts", script), "utf8"),
    await readFile(join(root, ".next/standalone/scripts", script), "utf8"),
    `Stale built startup script: ${script}`,
  );
}
for (const location of [root, join(root, ".next/standalone")]) {
  const files = await readdir(location);
  assert.equal(files.some((name) => name.startsWith(".env") && name !== ".env.example"), false, "Real environment files must never be packaged");
}
const migrationFiles = (await readdir(join(root, "migrations"))).filter((file) => file.endsWith(".sql"));
assert.ok(migrationFiles.length >= 7);
for (const file of migrationFiles) {
  const source = await readFile(join(root, "migrations", file));
  const built = await readFile(join(root, ".next/standalone/migrations", file));
  assert.equal(createHash("sha256").update(source).digest("hex"), createHash("sha256").update(built).digest("hex"), `Stale built migration: ${file}`);
}
assert.ok((await readdir(join(root, ".next/standalone/.next/static"))).length > 0);
assert.ok((await readdir(join(root, ".next/standalone/public"))).length > 0);
console.log(`Validated Portal AI ${pkg.version} standalone build, ${migrationFiles.length} migrations and Liara configuration.`);
NODE
