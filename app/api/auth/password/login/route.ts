import { z } from "zod";
import { completeAuthentication, type AuthUser } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { getEnv } from "../../../../../lib/env";
import { authError, noStoreJson, parseJsonBody, requestError, runtimeUnavailable } from "../../../../../lib/http";
import { hashPassword, verifyPassword } from "../../../../../lib/password";
import { clearRateLimit, rateLimit } from "../../../../../lib/redis";
import { assertSafeMutation, getClientIp, hmac, isAdminIpAllowed, normalizeIranianPhone, safeEqualText } from "../../../../../lib/security";

export const runtime = "nodejs";

const schema = z.object({
  phone: z.string().min(7).max(30),
  password: z.string().min(1).max(128),
}).strict();

function logLoginFailure(request: Request, error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  const errorCode = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  let originHost = "missing";
  let requestHost = "missing";
  try { originHost = request.headers.get("origin") ? new URL(request.headers.get("origin")!).host : "missing"; } catch { originHost = "invalid"; }
  try { requestHost = new URL(request.url).host; } catch { requestHost = "invalid"; }
  const category = message === "INVALID_ORIGIN"
    ? "INVALID_ORIGIN"
    : message.startsWith("Portal AI runtime")
      ? "RUNTIME_CONFIGURATION"
      : /(?:ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|Redis|postgres)/i.test(message)
        ? "INFRASTRUCTURE_CONNECTION"
        : errorCode || (error instanceof Error ? error.name : "UNKNOWN");
  console.error("[portal-auth] password login failed", { category, originHost, requestHost });
}

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 4_000));
    if (!parsed.success) return authError("INVALID_CREDENTIALS", "شماره موبایل یا رمز عبور درست نیست.", 401);
    const phone = normalizeIranianPhone(parsed.data.phone);
    if (!phone) return authError("INVALID_CREDENTIALS", "شماره موبایل یا رمز عبور درست نیست.", 401);

    const env = getEnv();
    const ip = getClientIp(request);
    const configuredAdminPhone = Boolean(env.ADMIN_PHONE_E164 && env.ADMIN_PHONE_E164 === phone);
    const allowlistConfigured = Boolean(env.ADMIN_IP_ALLOWLIST?.trim());
    if (configuredAdminPhone && allowlistConfigured && !isAdminIpAllowed(ip, env.ADMIN_IP_ALLOWLIST)) {
      return authError("ADMIN_NETWORK_RESTRICTED", "ورود مدیریت از این شبکه مجاز نیست.", 403);
    }
    const ipKey = `password-login:ip:${hmac(ip, env.OTP_PEPPER)}`;
    const accountKey = `password-login:account:${hmac(phone, env.OTP_PEPPER)}`;
    const loginWindowSeconds = configuredAdminPhone ? 300 : 900;
    const [ipLimit, accountLimit] = await Promise.all([
      rateLimit(ipKey, 40, loginWindowSeconds),
      rateLimit(accountKey, 8, loginWindowSeconds),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      return authError("LOGIN_RATE_LIMITED", `تلاش‌های ورود بیش از حد بود؛ ${configuredAdminPhone ? "۵" : "۱۵"} دقیقه بعد دوباره امتحان کن.`, 429, {
        "retry-after": String(Math.max(ipLimit.retryAfter, accountLimit.retryAfter)),
      });
    }

    let [row] = await db()<Array<AuthUser & { phone_e164: string; password_hash: string | null }>>`
      select u.id,u.phone_e164,u.role,u.status,u.display_name,c.password_hash
      from users u
      left join user_password_credentials c on c.user_id=u.id
      where u.phone_e164=${phone} and u.deleted_at is null
      limit 1
    `;
    const passwordResetRequested = env.ADMIN_PASSWORD_RESET === "true";
    if (configuredAdminPhone && env.ADMIN_PASSWORD && ((!row || row.role !== "admin" || !row.password_hash) || passwordResetRequested)) {
      if (!safeEqualText(parsed.data.password, env.ADMIN_PASSWORD)) {
        return authError("INVALID_CREDENTIALS", "شماره موبایل یا رمز عبور درست نیست.", 401);
      }
      const passwordHash = await hashPassword(env.ADMIN_PASSWORD!);
      row = await db().begin(async (tx) => {
        const [existing] = await tx<Array<AuthUser & { phone_e164: string; password_hash: string | null }>>`
          select u.id,u.phone_e164,u.role,u.status,u.display_name,c.password_hash
          from users u left join user_password_credentials c on c.user_id=u.id
          where u.phone_e164=${phone} and u.deleted_at is null
          limit 1 for update of u
        `;
        if (existing?.role === "admin" && existing.password_hash && !passwordResetRequested) return existing;
        const [admin] = existing
          ? await tx<Array<AuthUser & { phone_e164: string; password_hash: string | null }>>`
              update users set role='admin',status='active',updated_at=now(),terms_accepted_at=coalesce(terms_accepted_at,now())
              where id=${existing.id}
              returning id,phone_e164,role,status,display_name,null::text as password_hash
            `
          : await tx<Array<AuthUser & { phone_e164: string; password_hash: string | null }>>`
              insert into users(phone_e164,status,role,last_login_at,terms_accepted_at)
              values(${phone},'active','admin',now(),now())
              returning id,phone_e164,role,status,display_name,null::text as password_hash
            `;
        await tx`insert into user_password_credentials(user_id,password_hash) values(${admin.id},${passwordHash}) on conflict(user_id) do update set password_hash=excluded.password_hash,password_changed_at=now()`;
        await tx`
          insert into subscriptions(user_id,plan_id,status,starts_at,ends_at)
          select ${admin.id},p.id,'active',now(),now()+interval '100 years' from plans p
          where p.code='free' and not exists(select 1 from subscriptions s where s.user_id=${admin.id} and s.status='active' and s.ends_at>now())
        `;
        await tx`update users set role='user',updated_at=now() where role='admin' and id<>${admin.id}`;
        const eventType = existing?.role === "admin" && existing.password_hash ? "admin_password_rotated" : "admin_password_bootstrapped";
        await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${admin.id},${eventType},'warning',${hmac(ip,env.SESSION_PEPPER)},${tx.json({ bootstrap: "environment_password", ipAllowlistEnabled: allowlistConfigured, passwordResetRequested })})`;
        return { ...admin, password_hash: passwordHash };
      });
    }
    const adminLoginKey = row?.role === "admin" ? `admin-password-login:${hmac(phone, env.OTP_PEPPER)}` : null;
    if (adminLoginKey) {
      const adminLimit = await rateLimit(adminLoginKey, 5, 300);
      if (!adminLimit.allowed) {
        return authError("LOGIN_RATE_LIMITED", "تلاش‌های ورود بیش از حد بود؛ ۵ دقیقه بعد دوباره امتحان کن.", 429, {
          "retry-after": String(adminLimit.retryAfter),
        });
      }
    }
    const passwordMatches = await verifyPassword(parsed.data.password, row?.password_hash);
    if (!row || !passwordMatches) {
      return authError("INVALID_CREDENTIALS", "شماره موبایل یا رمز عبور درست نیست.", 401);
    }
    if (row.status !== "active") {
      return authError("ACCOUNT_UNAVAILABLE", "این حساب برای بررسی امنیتی در دسترس نیست.", 403);
    }

    if (row.role === "admin") {
      if (allowlistConfigured && !isAdminIpAllowed(ip, env.ADMIN_IP_ALLOWLIST)) {
        await db()`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${row.id},'admin_login_network_rejected','critical',${hmac(ip,env.SESSION_PEPPER)},'{}'::jsonb)`;
        return authError("ADMIN_NETWORK_RESTRICTED", "ورود مدیریت از این شبکه مجاز نیست.", 403);
      }
    }

    await db()`update users set last_login_at=now(),updated_at=now() where id=${row.id}`;
    await Promise.all([clearRateLimit(accountKey), ...(adminLoginKey ? [clearRateLimit(adminLoginKey)] : [])]);
    if (row.role === "admin") await db()`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${row.id},'admin_login_success','info',${hmac(ip,env.SESSION_PEPPER)},'{}'::jsonb)`;
    return noStoreJson(await completeAuthentication(row, phone, request, row.role === "admin"));
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    logLoginFailure(request, error);
    if (code === "INVALID_ORIGIN") return authError("INVALID_ORIGIN", "دامنه فعلی با PUBLIC_APP_URL یکسان نیست؛ آدرس نهایی سایت را در Environment اصلاح کن.", 403);
    if (["INVALID_CONTENT_TYPE", "BODY_TOO_LARGE", "EMPTY_BODY", "INVALID_JSON"].includes(code)) return authError("INVALID_REQUEST", "درخواست ورود معتبر نیست.", 400);
    if (code.startsWith("Portal AI runtime") || code.includes("connect") || code.includes("ECONN")) return runtimeUnavailable();
    return authError("LOGIN_UNAVAILABLE", "ورود موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کن.", 503);
  }
}
