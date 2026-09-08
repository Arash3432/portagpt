import { isIP } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeEnvironment(raw) {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    let cleaned = typeof value === "string" ? value.trim() : value;
    if (typeof cleaned === "string" && cleaned.length >= 2 &&
      ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'")))) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    return [key, cleaned || undefined];
  }));
}

// Only field names and fixed codes are returned: deployment logs must never
// contain connection strings, passwords, access keys, or parser input values.
export function validateRuntimeEnvironment(raw = process.env) {
  const env = normalizeEnvironment(raw);
  const production = !env.NODE_ENV || env.NODE_ENV === "production";
  const issues = [];
  const warnings = [];
  const add = (field, code) => issues.push({ field, code });
  const placeholder = (value) => /REPLACE_WITH|YOUR[-_]|PASTE_ONLY|SET_ONLY|GENERATED_SECRET|CHANGE_ME/i.test(value || "");
  const urlField = (field, protocols, required = true) => {
    if (!env[field]) { if (required) add(field, "REQUIRED"); return null; }
    try {
      const url = new URL(env[field]);
      if (!protocols.includes(url.protocol) || !url.hostname || url.hash || placeholder(env[field])) {
        add(field, "INVALID_URL");
        return null;
      }
      return url;
    } catch { add(field, "INVALID_URL"); return null; }
  };
  if (env.NODE_ENV && !["production", "development", "test"].includes(env.NODE_ENV)) add("NODE_ENV", "INVALID_VALUE");
  urlField("DATABASE_URL", ["postgres:", "postgresql:"]);
  urlField("REDIS_URL", ["redis:", "rediss:"]);
  const origin = urlField("PUBLIC_APP_URL", production ? ["https:"] : ["http:", "https:"]);
  if (origin && (origin.username || origin.password || origin.search || origin.pathname !== "/")) add("PUBLIC_APP_URL", "ORIGIN_REQUIRED");
  for (const field of ["SESSION_PEPPER", "OTP_PEPPER"]) {
    if (!env[field] || env[field].length < 32 || placeholder(env[field])) add(field, "STRONG_SECRET_REQUIRED");
  }
  if (env.SESSION_PEPPER && env.SESSION_PEPPER === env.OTP_PEPPER) add("OTP_PEPPER", "SECRETS_MUST_DIFFER");
  const key = env.CONFIG_ENCRYPTION_KEY;
  if (production && !key) add("CONFIG_ENCRYPTION_KEY", "REQUIRED");
  if (key && (!(/^[a-f0-9]{64}$/i.test(key) || (/^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, "base64").length === 32)) || placeholder(key))) {
    add("CONFIG_ENCRYPTION_KEY", "INVALID_32_BYTE_KEY");
  }
  if (production && env.OTP_DEV_CODE) add("OTP_DEV_CODE", "FORBIDDEN_IN_PRODUCTION");
  for (const [field, options] of Object.entries({
    DATABASE_SSL_MODE: ["disable", "require"],
    PAYMENTS_ENABLED: ["true", "false"],
    PORTAL_IMAGE_WORKER_EAGER_START: ["true", "false"],
  })) if (env[field] && !options.includes(env[field])) add(field, "INVALID_VALUE");
  for (const [field, min, max] of [["PORT", 1, 65535], ["DB_POOL_MAX", 2, 50], ["TRUSTED_PROXY_HOPS", 1, 5], ["MIGRATION_WAIT_SECONDS", 10, 300]]) {
    if (env[field] && (!/^\d+$/.test(env[field]) || Number(env[field]) < min || Number(env[field]) > max)) add(field, "INVALID_INTEGER");
  }
  const storageFields = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  if (storageFields.some((field) => env[field])) {
    for (const field of storageFields) if (!env[field] || placeholder(env[field])) add(field, "INCOMPLETE_STORAGE_CONFIGURATION");
    const endpoint = urlField("S3_ENDPOINT", production ? ["https:"] : ["http:", "https:"], false);
    if (endpoint && (endpoint.username || endpoint.password || endpoint.search)) add("S3_ENDPOINT", "INVALID_URL");
  } else warnings.push({ field: "S3_ENDPOINT", code: "FILE_AND_IMAGE_STORAGE_UNAVAILABLE" });
  if (env.ADMIN_IP_ALLOWLIST) {
    const entries = env.ADMIN_IP_ALLOWLIST.split(",").map((entry) => entry.trim());
    if (entries.some((entry) => !isIP(entry))) add("ADMIN_IP_ALLOWLIST", "EXACT_IP_ADDRESSES_REQUIRED");
  } else warnings.push({ field: "ADMIN_IP_ALLOWLIST", code: "ADMIN_ACCESS_DISABLED" });
  return { ok: issues.length === 0, issues, warnings };
}

export function assertRuntimeEnvironment(raw = process.env) {
  const result = validateRuntimeEnvironment(raw);
  if (!result.ok) {
    const error = new Error("RUNTIME_CONFIGURATION_INVALID");
    error.code = "RUNTIME_CONFIGURATION_INVALID";
    error.issues = result.issues;
    throw error;
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = validateRuntimeEnvironment();
  console[result.ok ? "log" : "error"](JSON.stringify({ event: "portal.preflight", ...result }));
  if (!result.ok) process.exitCode = 1;
}
