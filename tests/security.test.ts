import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { normalizeEmail } from "../lib/auth";
import { assetResponseHeaders } from "../lib/asset-response";
import { hashPassword, passwordPolicyError, verifyPassword } from "../lib/password";
import { estimateTextReservation } from "../lib/quotas";
import { validateProviderBaseUrl } from "../lib/provider";
import { getClientIp, isAdminIpAllowed, isAdminIpOnlyAllowed, normalizeIranianPhone, parseAdminIpAllowlist, randomOtp, safeEqualHex, safeEqualText, sha256 } from "../lib/security";

test("Iranian phone normalization accepts localized digits and rejects malformed values", () => {
  assert.equal(normalizeIranianPhone("۰۹۱۲ ۳۴۵ ۶۷۸۹"), "+989123456789");
  assert.equal(normalizeIranianPhone("0098-912-345-6789"), "+989123456789");
  assert.equal(normalizeIranianPhone("+989123456789"), "+989123456789");
  assert.equal(normalizeIranianPhone("091234567"), null);
  assert.equal(normalizeIranianPhone("+12025550123"), null);
});

test("admin IP handling works behind a proxy without treating placeholders as wildcards", () => {
  Object.assign(process.env, { NODE_ENV: "test", TRUSTED_PROXY_HOPS: "1", SESSION_PEPPER: "s".repeat(64), OTP_PEPPER: "o".repeat(64), DATABASE_URL: "postgres://test:test@localhost:5432/test", REDIS_URL: "redis://localhost:6379", PUBLIC_APP_URL: "http://localhost:3000" });
  const forwarded = new Request("http://localhost", { headers: { "x-forwarded-for": "198.51.100.7" } });
  const realIp = new Request("http://localhost", { headers: { "x-real-ip": "::ffff:198.51.100.7" } });
  assert.equal(getClientIp(forwarded), "198.51.100.7");
  assert.equal(getClientIp(realIp), "198.51.100.7");
  assert.deepEqual(parseAdminIpAllowlist(" 198.51.100.7, ::ffff:198.51.100.8 "), ["198.51.100.7", "198.51.100.8"]);
  assert.equal(isAdminIpAllowed("198.51.100.7", "198.51.100.7"), true);
  assert.equal(isAdminIpAllowed("198.51.100.7", "********"), false);
  assert.equal(isAdminIpAllowed("198.51.100.7", ""), true);
  assert.equal(isAdminIpOnlyAllowed("198.51.100.7", "198.51.100.7"), true);
  assert.equal(isAdminIpOnlyAllowed("198.51.100.7", ""), false);
});

test("OTP and constant-time comparison primitives have safe shapes", () => {
  assert.match(randomOtp(), /^\d{6}$/);
  const a = sha256("a"); const b = sha256("b");
  assert.equal(safeEqualHex(a, a), true); assert.equal(safeEqualHex(a, b), false); assert.equal(safeEqualHex(a, "00"), false);
  assert.equal(safeEqualText("admin-secret", "admin-secret"), true);
  assert.equal(safeEqualText("admin-secret", "different-secret"), false);
  assert.equal(safeEqualText("short", "longer"), false);
});

test("password authentication uses a memory-hard salted hash and a Unicode-aware policy", async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
    PUBLIC_APP_URL: "http://localhost:3000",
    SESSION_PEPPER: "s".repeat(64),
    OTP_PEPPER: "o".repeat(64),
  });
  assert.equal(passwordPolicyError("short1a"), "PASSWORD_TOO_SHORT");
  assert.equal(passwordPolicyError("عبورامنطولانی"), "PASSWORD_NEEDS_LETTER_AND_NUMBER");
  assert.equal(passwordPolicyError("عبورامن۱۲۳۴۵"), null);
  const encoded = await hashPassword("Correct horse 2026");
  assert.match(encoded, /^scrypt\$1\$32768\$8\$1\$/);
  assert.equal(await verifyPassword("Correct horse 2026", encoded), true);
  assert.equal(await verifyPassword("Wrong horse 2026", encoded), false);
  assert.equal(await verifyPassword("Wrong horse 2026", null), false);
});

test("email normalization is deterministic and rejects malformed identities", () => {
  assert.equal(normalizeEmail(" User.Name@Example.COM "), "user.name@example.com");
  assert.equal(normalizeEmail("user@@example.com"), null);
  assert.equal(normalizeEmail("user@example"), null);
});

test("cost reservation includes both input and maximum output exposure", () => {
  assert.equal(estimateTextReservation(3200, 4000, 1, 4), 17000);
  assert.ok(estimateTextReservation(1, 128, 0.1, 0.2) > 0);
});

test("client components never reference provider secrets", async () => {
  const dir = path.join(process.cwd(), "app", "ui");
  const files = (await readdir(dir)).filter((name) => name.endsWith(".tsx"));
  for (const file of files) {
    const source = await readFile(path.join(dir, file), "utf8");
    assert.equal(/AI_API_KEY|SESSION_PEPPER|OTP_PEPPER|DATABASE_URL/.test(source), false, `${file} leaks a server variable name`);
  }
});

test("payments fail closed and the Liara AI catalog has priced models", async () => {
  const env = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
  const catalog = JSON.parse(await readFile(path.join(process.cwd(), "config", "model-catalog.example.json"), "utf8"));
  assert.match(env, /^PAYMENTS_ENABLED=false$/m);
  assert.match(env, /^AI_BASE_URL=https:\/\/ai\.liara\.ir\/api\/6a8891dfffbd76a99cabcca4\/v1$/m);
  assert.match(env, /^AI_PROVIDER_HOST_ALLOWLIST=ai\.liara\.ir$/m);
  assert.match(env, /^DATABASE_SSL_MODE=disable$/m);
  assert.match(env, /^S3_REGION=default$/m);
  assert.match(env, /^CONFIG_ENCRYPTION_KEY=/m);
  assert.equal(catalog.filter((model: { type: string }) => model.type === "text").length, 21);
  assert.equal(catalog.filter((model: { type: string }) => model.type === "image").length, 2);
  assert.equal(catalog.every((model: { providerModel:string }) => /^(?:z-ai|moonshotai|anthropic|openai|google|x-ai)\//.test(model.providerModel)), true);
  assert.equal(catalog.every((model: { messageCredits?:number;imageCredits?:number;type:string }) => Number(model.type === "text" ? model.messageCredits : model.imageCredits) >= 1), true);
  assert.equal(catalog.every((model: { type: string; inputUsdPerMillion?: number; outputUsdPerMillion?: number; imageUsd?: number; costMultiplier?: number }) =>
    (model.type === "text" ? Number(model.inputUsdPerMillion) > 0 && Number(model.outputUsdPerMillion) > 0 : Number(model.imageUsd) > 0)
    && Number(model.costMultiplier ?? 1.35) >= 1), true);
});

test("offline secret helper uses the browser CSPRNG and no network resources", async () => {
  const helper = await readFile(path.join(process.cwd(), "GENERATE-SECRETS.html"), "utf8");
  assert.match(helper, /crypto\.getRandomValues/);
  assert.match(helper, /default-src 'none'/);
  assert.equal(/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i.test(helper), false);
});

test("database enforces immutable request ids and financial constraints", async () => {
  const migration = await readFile(path.join(process.cwd(), "migrations", "001_initial.sql"), "utf8");
  const controls = await readFile(path.join(process.cwd(), "migrations", "002_control_center.sql"), "utf8");
  const passwordAuth = await readFile(path.join(process.cwd(), "migrations", "003_password_auth.sql"), "utf8");
  const liaraCredits = await readFile(path.join(process.cwd(), "migrations", "004_liara_ai_credits_catalog.sql"), "utf8");
  const providerEnvironmentMigration = await readFile(path.join(process.cwd(), "migrations", "005_provider_base_url_from_environment.sql"), "utf8");
  assert.match(migration, /request_id uuid primary key/);
  assert.match(migration, /reserved_cost_micro_usd bigint not null check/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /token_hash char\(64\) not null unique/);
  assert.match(migration, /usage_buckets \(/);
  assert.match(migration, /portal_release_stale_reservations/);
  assert.match(controls, /provider_secrets/);
  assert.match(controls, /plan_usage_policies/);
  assert.match(controls, /usage_kind in \('text','image'\)/);
  assert.match(controls, /admin_audit_logs_append_only/);
  assert.match(passwordAuth, /user_password_credentials/);
  assert.match(passwordAuth, /users_email_unique_idx/);
  assert.match(liaraCredits, /text_credit_ledger/);
  assert.match(liaraCredits, /when 'starter' then 25 when 'plus' then 85 when 'pro' then 300 when 'ultra' then 600/);
  assert.match(liaraCredits, /when 'starter' then 250 when 'plus' then 1000 when 'pro' then 5000 when 'ultra' then 20000/);
  assert.match(liaraCredits, /when 'starter' then 15 when 'plus' then 100 when 'pro' then 450 when 'ultra' then 950/);
  assert.match(liaraCredits, /google\/gemini-3-pro-image-preview/);
  assert.match(providerEnvironmentMigration, /value = value - 'baseUrl'/);
});

test("password-first auth protects the configured administrator from self-registration or OTP elevation", async () => {
  const capabilities = await readFile(path.join(process.cwd(), "app", "api", "auth", "capabilities", "route.ts"), "utf8");
  const registration = await readFile(path.join(process.cwd(), "app", "api", "auth", "password", "register", "route.ts"), "utf8");
  const login = await readFile(path.join(process.cwd(), "app", "api", "auth", "password", "login", "route.ts"), "utf8");
  const otpRequest = await readFile(path.join(process.cwd(), "app", "api", "auth", "otp", "request", "route.ts"), "utf8");
  assert.match(capabilities, /defaultMethod: "password"/);
  assert.match(registration, /phone: z\.string/);
  assert.match(registration, /email: z\.string/);
  assert.match(registration, /passwordConfirmation/);
  assert.match(registration, /ADMIN_PASSWORD_REQUIRED/);
  assert.match(registration, /'active','user'/);
  assert.equal(/admin_password_bootstrapped/.test(registration), false);
  assert.match(login, /verifyPassword/);
  assert.match(login, /safeEqualText/);
  assert.match(login, /admin_password_bootstrapped/);
  assert.match(login, /allowlistConfigured && !isAdminIpAllowed\(ip, env\.ADMIN_IP_ALLOWLIST\)/);
  assert.match(login, /password-login:account/);
  assert.match(otpRequest, /PASSWORD_FALLBACK_REQUIRED/);
  const otpVerify = await readFile(path.join(process.cwd(), "app", "api", "auth", "otp", "verify", "route.ts"), "utf8");
  assert.match(otpVerify, /ADMIN_PASSWORD_REQUIRED/);
  assert.equal(/update users set role='user'/.test(otpVerify), false);
});

test("authenticated UI routes wait for session resolution instead of reopening credential dialogs", async () => {
  const [shell, workspace, account, settings, landing, plans] = await Promise.all([
    readFile(path.join(process.cwd(), "app", "ui", "public-shell.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "ui", "portal-app.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "ui", "account-center.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "ui", "settings-center.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "ui", "portal-landing.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "app", "ui", "portal-plans.tsx"), "utf8"),
  ]);
  assert.match(shell, /const authPromptAllowed = auth\.status === "anonymous"/);
  assert.match(shell, /auth\.status === "checking"/);
  assert.match(workspace, /authStatus === "checking"/);
  assert.match(workspace, /authStatus === "authenticated"/);
  assert.match(workspace, /setAuthOpen\(false\)/);
  assert.match(account, /session\.status === "unavailable"/);
  assert.match(settings, /session\.status === "unavailable"/);
  assert.match(landing, /session\.startHref/);
  assert.match(plans, /session\.isAuthenticated/);
});

test("admin UI uses IP-gated data APIs without reopening credential dialogs", async () => {
  const admin = await readFile(path.join(process.cwd(), "app", "ui", "portal-admin.tsx"), "utf8");
  assert.match(admin, /json\("\/api\/admin\/overview"\)/);
  assert.doesNotMatch(admin, /\/api\/auth\/session/);
  assert.doesNotMatch(admin, /ADMIN_PASSWORD|ADMIN_PHONE_E164/);
  assert.match(admin, /userRequestVersion/);
  assert.match(admin, /drawerRequestVersion/);
  assert.match(admin, /selectedUserId/);
});

test("admin step-up compatibility route never processes credentials in IP-only mode", async () => {
  const stepUp = await readFile(path.join(process.cwd(), "app", "api", "admin", "step-up", "route.ts"), "utf8");
  assert.match(stepUp, /requireAdmin/);
  assert.match(stepUp, /IP-only/);
  assert.doesNotMatch(stepUp, /verifyPassword|isSmsConfigured|password_hash|OTP_PEPPER/);
});

test("concurrent quota updates are conditional and OTP attempts are atomic", async () => {
  const quota = await readFile(path.join(process.cwd(), "lib", "quotas.ts"), "utf8");
  const chat = await readFile(path.join(process.cwd(), "app", "api", "chat", "route.ts"), "utf8");
  const imageQueue = await readFile(path.join(process.cwd(), "lib", "image-queue.ts"), "utf8");
  const redis = await readFile(path.join(process.cwd(), "lib", "redis.ts"), "utf8");
  assert.match(quota, /reserved_micro_usd\+spent_micro_usd\+/);
  assert.match(quota, /GLOBAL_COST_CIRCUIT_OPEN/);
  assert.match(quota, /TEXT_CREDITS_3H_EXCEEDED/);
  assert.match(quota, /TEXT_CREDITS_WEEKLY_EXCEEDED/);
  assert.match(quota, /pg_advisory_xact_lock\(hashtext/);
  assert.match(quota, /weekly\*4\.35<=allowedMonthlyMicroUsd/);
  assert.match(chat, /primaryReservation \+ fallbackReservation/);
  assert.match(chat, /free:512, starter:1024, plus:2048, pro:3072, ultra:4096/);
  assert.match(imageQueue, /maxStalledCount:0/);
  assert.match(imageQueue, /"idempotency-key":requestId/);
  assert.match(redis, /consumeOtpAttempt/);
  assert.match(redis, /client\.eval/);
});

test("generated-image URLs are protected from SSRF", async () => {
  const storage = await readFile(path.join(process.cwd(), "lib", "storage.ts"), "utf8");
  const chat = await readFile(path.join(process.cwd(), "app", "api", "chat", "route.ts"), "utf8");
  const imageQueue = await readFile(path.join(process.cwd(), "lib", "image-queue.ts"), "utf8");
  const sms = await readFile(path.join(process.cwd(), "lib", "sms.ts"), "utf8");
  assert.match(storage, /AI_IMAGE_HOST_ALLOWLIST/);
  assert.match(storage, /redirect: "error"/);
  assert.match(storage, /IMAGE_URL_NOT_ALLOWLISTED/);
  assert.match(chat, /redirect: "error"/);
  assert.match(imageQueue, /redirect:"error"/);
  assert.match(sms, /redirect: "error"/);
});

test("admin can be restricted to a trusted IP allowlist", async () => {
  const session = await readFile(path.join(process.cwd(), "lib", "session.ts"), "utf8");
  const vault = await readFile(path.join(process.cwd(), "lib", "vault.ts"), "utf8");
  const provider = await readFile(path.join(process.cwd(), "lib", "provider.ts"), "utf8");
  const sampleEnv = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
  assert.match(session, /ADMIN_IP_ALLOWLIST/);
  assert.match(session, /requireElevatedAdmin/);
  assert.match(vault, /aes-256-gcm/);
  assert.equal(/REQUIRED_LIARA_AI_BASE_URL/.test(provider), false);
  assert.match(provider, /AI_PROVIDER_HOST_ALLOWLIST/);
  assert.match(sampleEnv, /TRUSTED_PROXY_HOPS=1/);
});

test("provider endpoints require an allowlisted public hostname", () => {
  assert.equal(validateProviderBaseUrl("https://ai.liara.ir/v1"), "https://ai.liara.ir/v1");
  assert.throws(() => validateProviderBaseUrl("https://169.254.169.254/latest"), /PROVIDER_URL_INVALID/);
  assert.throws(() => validateProviderBaseUrl("https://[fd00::1]/v1"), /PROVIDER_URL_INVALID/);
  assert.throws(() => validateProviderBaseUrl("https://example.com/v1"), /PROVIDER_HOST_NOT_ALLOWLISTED/);
});

test("private assets and service-worker caching fail closed", async () => {
  const asset = await readFile(path.join(process.cwd(), "app", "api", "assets", "[id]", "route.ts"), "utf8");
  const worker = await readFile(path.join(process.cwd(), "public", "sw.js"), "utf8");
  assert.match(asset, /assetResponseHeaders/);
  assert.match(assetResponseHeaders({ original_name: "image.png", mime_type: "image/png", size_bytes: 100 }, false).get("cache-control") || "", /(?:^|, )no-store(?:,|$)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(worker, /\bno-store\b/);
  assert.equal(/caches\.match\("\/"\)/.test(worker), false);
});

test("admin mutations use the IP-only administrator context", async () => {
  const session = await readFile(path.join(process.cwd(), "lib", "session.ts"), "utf8");
  const page = await readFile(path.join(process.cwd(), "app", "admin", "page.tsx"), "utf8");
  assert.match(session, /isAdminIpOnlyAllowed/);
  assert.match(session, /ip-only-admin/);
  assert.match(page, /notFound/);
  assert.match(page, /ADMIN_IP_ALLOWLIST/);
});

test("account security supports password rotation and session revocation", async () => {
  const password = await readFile(path.join(process.cwd(), "app", "api", "account", "password", "route.ts"), "utf8");
  const sessions = await readFile(path.join(process.cwd(), "app", "api", "account", "sessions", "route.ts"), "utf8");
  assert.match(password, /verifyPassword/);
  assert.match(password, /passwordPolicyError/);
  assert.match(password, /password_changed/);
  assert.match(password, /id\s*<>\s*\$\{session\.sessionId\}/);
  assert.match(sessions, /parsed\.data\.others/);
  assert.match(sessions, /session_revoked/);
});

test("Liara private PostgreSQL does not force public TLS semantics", async () => {
  const runtimeDb = await readFile(path.join(process.cwd(), "lib", "db.ts"), "utf8");
  const migrate = await readFile(path.join(process.cwd(), "scripts", "migrate.mjs"), "utf8");
  assert.match(runtimeDb, /DATABASE_SSL_MODE === "require"/);
  assert.match(migrate, /sslMode === "require"/);
  assert.equal(/DATABASE_URL\.includes\("localhost"\)/.test(runtimeDb + migrate), false);
});

test("blank optional Liara variables are normalized and the validated startup is used", async () => {
  const runtimeEnv = await readFile(path.join(process.cwd(), "lib", "env.ts"), "utf8");
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  assert.match(runtimeEnv, /blankToUndefined/);
  assert.match(runtimeEnv, /S3_ENDPOINT: optionalText/);
  assert.equal(pkg.scripts.start, "node scripts/start.mjs");
});

test("storage use independently validates endpoints after deployment preflight", async () => {
  const runtimeEnv = await readFile(path.join(process.cwd(), "lib", "env.ts"), "utf8");
  const storage = await readFile(path.join(process.cwd(), "lib", "storage.ts"), "utf8");
  assert.match(runtimeEnv, /S3_ENDPOINT: optionalText/);
  assert.match(storage, /validatedStorageEndpoint/);
  assert.match(storage, /STORAGE_ENDPOINT_INVALID/);
  assert.match(storage, /endpoint\.protocol !== "https:"/);
});

test("Liara startup serves built assets without runtime filesystem writes", async () => {
  const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const nextConfig = await readFile(path.join(process.cwd(), "next.config.ts"), "utf8");
  const dockerfile = await readFile(path.join(process.cwd(), "Dockerfile"), "utf8");
  assert.equal(pkg.scripts.start, "node scripts/start.mjs");
  assert.equal(/output:\s*["']standalone["']/.test(nextConfig), true);
  assert.match(dockerfile, /\/app\/\.next\/standalone \.\//);
  assert.match(pkg.scripts.build, /prepare-standalone/);
  const startup = await readFile(path.join(process.cwd(), "scripts", "start.mjs"), "utf8");
  assert.match(startup, /assertRuntimeEnvironment/);
  assert.match(startup, /await runMigrations/);
  assert.equal(/\b(?:writeFile|cp|mkdir)\b/.test(startup), false);
  assert.equal(/start-server|fs\/promises|\bcp\b/.test(pkg.scripts.start), false);
});
