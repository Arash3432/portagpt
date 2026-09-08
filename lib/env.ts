import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalText = z.preprocess(blankToUndefined, z.string().optional());
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());
const DEFAULT_AI_BASE_URL = "https://ai.liara.ir/api/6a8891dfffbd76a99cabcca4/v1";
const DEFAULT_AI_PROVIDER_HOST_ALLOWLIST = "ai.liara.ir";

function cleanEnvValue(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim() || undefined;
  }
  return trimmed;
}

function normalizeAiBaseUrl(value: unknown) {
  const cleaned = cleanEnvValue(value);
  if (!cleaned) return DEFAULT_AI_BASE_URL;
  try {
    const url = new URL(String(cleaned));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return DEFAULT_AI_BASE_URL;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_AI_BASE_URL;
  }
}

function normalizedProcessEnv() {
  const values = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key, cleanEnvValue(value)]),
  );
  // BASE_AI_URL was used in an earlier Liara setup guide. Keep it as a
  // compatibility alias while AI_BASE_URL remains the canonical server key.
  if (!values.AI_BASE_URL && values.BASE_AI_URL) values.AI_BASE_URL = values.BASE_AI_URL;
  values.AI_BASE_URL = normalizeAiBaseUrl(values.AI_BASE_URL);
  return values;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL_MODE: z.enum(["disable", "require"]).default("disable"),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  REDIS_URL: z.string().url(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),
  SESSION_PEPPER: z.string().min(32),
  OTP_PEPPER: z.string().min(32),
  PUBLIC_APP_URL: z.string().url(),
  AI_BASE_URL: z.preprocess(
    (value) => cleanEnvValue(value) || DEFAULT_AI_BASE_URL,
    z.string().url(),
  ),
  AI_API_KEY: z.preprocess(blankToUndefined, z.string().min(12).optional()),
  AI_CHAT_PATH: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default("/chat/completions"),
  AI_IMAGE_PATH: z.string().regex(/^\/[A-Za-z0-9_./-]+$/).default("/images/generations"),
  AI_IMAGE_HOST_ALLOWLIST: optionalText,
  MODEL_CATALOG_JSON: z.preprocess(blankToUndefined, z.string().min(2).optional()),
  SIRIUS_FALLBACK_MODEL_ALIAS: optionalText,
  GLOBAL_DAILY_COST_CAP_USD: z.coerce.number().positive().default(5),
  USD_TOMAN_RATE: z.coerce.number().positive().default(200_000),
  MAX_API_COST_SHARE: z.coerce.number().min(0.05).max(0.4).default(0.30),
  CONFIG_ENCRYPTION_KEY: optionalText,
  AI_PROVIDER_HOST_ALLOWLIST: z.preprocess(
    (value) => cleanEnvValue(value) || DEFAULT_AI_PROVIDER_HOST_ALLOWLIST,
    z.string().min(1),
  ),
  ADMIN_REAUTH_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  // IP allowlisting remains an independent network control. Keep the more
  // fragile session IP binding opt-in so a normal ISP/VPN address change does
  // not revoke a valid administrator session.
  ADMIN_SESSION_BIND_IP: z.enum(["true", "false"]).default("false"),
  // Recovery only: when enabled, ADMIN_PASSWORD may replace an existing
  // administrator password for the configured administrator phone.
  ADMIN_PASSWORD_RESET: z.enum(["true", "false"]).default("false"),
  SMS_API_URL: optionalUrl,
  SMS_API_TOKEN: optionalText,
  SMS_TEMPLATE: z.string().default("portal-login"),
  SMS_AUTH_HEADER: z.string().default("Authorization"),
  SMS_AUTH_SCHEME: z.string().default("Bearer"),
  OTP_DEV_CODE: z.preprocess(blankToUndefined, z.string().regex(/^\d{6}$/).optional()),
  // The endpoint is validated only when storage is used, so a stale placeholder
  // in a hosting panel cannot take down the landing page during startup.
  S3_ENDPOINT: optionalText,
  S3_REGION: z.preprocess(blankToUndefined, z.string().default("default")),
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
  PAYMENT_GATEWAY_URL: optionalUrl,
  PAYMENT_GATEWAY_KEY: optionalText,
  ADMIN_PHONE_E164: z.preprocess(blankToUndefined, z.string().regex(/^\+\d{10,15}$/).optional()),
  ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(10).max(128).optional()),
  ADMIN_IP_ALLOWLIST: optionalText,
});

export type PortalEnv = z.infer<typeof envSchema>;

let cached: PortalEnv | null = null;

export function getEnv(): PortalEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(normalizedProcessEnv());
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Portal AI runtime configuration is incomplete: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction() {
  return cleanEnvValue(process.env.NODE_ENV) === "production";
}
