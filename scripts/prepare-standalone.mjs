import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, ".next", "standalone");
await access(path.join(target, "server.js"));
await mkdir(path.join(target, "scripts"), { recursive: true });
await cp(path.join(root, "public"), path.join(target, "public"), { recursive: true });
await cp(path.join(root, ".next", "static"), path.join(target, ".next", "static"), { recursive: true });
await cp(path.join(root, "migrations"), path.join(target, "migrations"), { recursive: true });
for (const file of ["start.mjs", "preflight.mjs", "migrate.mjs", "migration-compatibility.mjs", "migration-history.mjs", "migration-report.mjs", "migration-status.mjs", "migration-schema-contract.json"]) {
  await cp(path.join(root, "scripts", file), path.join(target, "scripts", file));
}
// The migration runner is not a Next route: Next may bundle postgres into route
// chunks without tracing its package directory. Ship its dependency-free Node
// package explicitly so the startup import works in the isolated Docker image.
await cp(path.join(root, "node_modules", "postgres"), path.join(target, "node_modules", "postgres"), { recursive: true });
await access(path.join(target, "node_modules", "postgres", "package.json"));
console.log("Portal AI standalone server and static assets are ready.");
