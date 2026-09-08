import { z } from "zod";
import { completeAuthentication, type AuthUser } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { getEnv } from "../../../../../lib/env";
import { authError, noStoreJson, parseJsonBody, requestError, runtimeUnavailable } from "../../../../../lib/http";
import { consumeOtpAttempt, rateLimit, redis } from "../../../../../lib/redis";
import { assertSafeMutation, getClientIp, hmac, normalizeIranianPhone, safeEqualHex } from "../../../../../lib/security";

export const runtime = "nodejs";
const schema = z.object({ phone: z.string().min(7).max(30), code: z.string().regex(/^\d{6}$/) }).strict();

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 2_000));
    if (!parsed.success) return authError("INVALID_OTP", "کد منقضی شده یا معتبر نیست.", 400);
    const phone = normalizeIranianPhone(parsed.data.phone);
    if (!phone) return authError("INVALID_OTP", "کد منقضی شده یا معتبر نیست.", 400);
    const env = getEnv();
    if (env.ADMIN_PHONE_E164 === phone) {
      return authError("ADMIN_PASSWORD_REQUIRED", "ورود مدیر فقط با رمز عبور انجام می‌شود؛ کد پیامکی تنها برای تأیید دوباره عملیات حساس است.", 403);
    }
    const ipLimit = await rateLimit(`otpverify:ip:${hmac(getClientIp(request), env.OTP_PEPPER)}`, 200, 3600);
    if (!ipLimit.allowed) return authError("OTP_RATE_LIMITED", "تلاش‌های زیادی انجام شده؛ بعداً دوباره امتحان کن.", 429, { "retry-after": String(ipLimit.retryAfter) });
    const client = await redis();
    const key = `otp:${hmac(phone, env.OTP_PEPPER)}`;
    const [expectedHash, salt] = await client.hmGet(key, ["hash", "salt"]);
    if (!expectedHash || !salt) return authError("INVALID_OTP", "کد منقضی شده یا معتبر نیست.", 400);
    const candidate = hmac(`${phone}:${parsed.data.code}:${salt}`, env.OTP_PEPPER);
    const result = await consumeOtpAttempt(key, expectedHash, salt, safeEqualHex(candidate, expectedHash));
    if (result !== 1) return authError("INVALID_OTP", "کد منقضی شده یا معتبر نیست.", 400);

    const sql = db();
    const [existing] = await sql<AuthUser[]>`select id,role,status,display_name from users where phone_e164=${phone} and deleted_at is null limit 1`;
    if (!existing) return authError("ACCOUNT_NOT_FOUND", "ابتدا با شماره، ایمیل و رمز عبور ثبت‌نام کن.", 404);
    if (existing.role === "admin") return authError("ADMIN_PASSWORD_REQUIRED", "ورود مدیر فقط با رمز عبور انجام می‌شود.", 403);
    const user = await sql.begin(async (tx) => {
      await tx`update users set phone_verified_at=now(),last_login_at=now(),updated_at=now() where id=${existing.id}`;
      await tx`
        insert into subscriptions(user_id,plan_id,status,starts_at,ends_at)
        select ${existing.id},p.id,'active',now(),now()+interval '100 years' from plans p
        where p.code='free' and not exists(select 1 from subscriptions s where s.user_id=${existing.id} and s.status='active' and s.ends_at>now())
      `;
      const [updated] = await tx<AuthUser[]>`select id,role,status,display_name from users where id=${existing.id}`;
      return updated;
    });
    if (user.role === "admin") return authError("ADMIN_PASSWORD_REQUIRED", "ورود مدیر فقط با رمز عبور انجام می‌شود.", 403);
    if (user.status !== "active") return authError("ACCOUNT_UNAVAILABLE", "این حساب برای بررسی امنیتی در دسترس نیست.", 403);
    return noStoreJson(await completeAuthentication(user, phone, request, false));
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code.startsWith("Portal AI runtime") || code.includes("connect") || code.includes("ECONN")) return runtimeUnavailable();
    return authError("OTP_LOGIN_UNAVAILABLE", "ورود با کد انجام نشد؛ با رمز عبور وارد شو.", 503);
  }
}
