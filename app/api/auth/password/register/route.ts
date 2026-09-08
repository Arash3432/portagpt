import { z } from "zod";
import { completeAuthentication, normalizeEmail, type AuthUser } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { getEnv } from "../../../../../lib/env";
import { authError, noStoreJson, parseJsonBody, requestError, runtimeUnavailable } from "../../../../../lib/http";
import { hashPassword, passwordPolicyError } from "../../../../../lib/password";
import { rateLimit } from "../../../../../lib/redis";
import { assertSafeMutation, getClientIp, hashIp, hmac, normalizeIranianPhone } from "../../../../../lib/security";
import { generateUniqueUsername } from "../../../../../lib/username";

export const runtime = "nodejs";

const schema = z.object({
  phone: z.string().min(7).max(30),
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(128),
  passwordConfirmation: z.string().min(1).max(128),
}).strict();

const policyMessages: Record<string, string> = {
  PASSWORD_TOO_SHORT: "رمز عبور باید حداقل ۱۰ نویسه داشته باشد.",
  PASSWORD_TOO_LONG: "رمز عبور نباید بیشتر از ۱۲۸ نویسه باشد.",
  PASSWORD_NEEDS_LETTER_AND_NUMBER: "رمز عبور باید حداقل یک حرف و یک عدد داشته باشد.",
  PASSWORD_TOO_COMMON: "این رمز عبور بیش از حد قابل‌حدس است؛ رمز دیگری انتخاب کن.",
};

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 5_000));
    if (!parsed.success) return authError("INVALID_REGISTRATION", "اطلاعات ثبت‌نام کامل یا معتبر نیست.", 400);
    const phone = normalizeIranianPhone(parsed.data.phone);
    const email = normalizeEmail(parsed.data.email);
    if (!phone) return authError("INVALID_PHONE", "شماره موبایل ایران را به‌درستی وارد کن.", 400);
    if (!email) return authError("INVALID_EMAIL", "ایمیل را به‌درستی وارد کن.", 400);
    if (parsed.data.password !== parsed.data.passwordConfirmation) return authError("PASSWORD_MISMATCH", "رمز عبور و تکرار آن یکسان نیستند.", 400);
    const policyError = passwordPolicyError(parsed.data.password);
    if (policyError) return authError(policyError, policyMessages[policyError], 400);

    const env = getEnv();
    const ip = getClientIp(request);
    const limits = await Promise.all([
      rateLimit(`password-register:ip:${hmac(ip, env.OTP_PEPPER)}`, 50, 3600),
      rateLimit(`password-register:phone:${hmac(phone, env.OTP_PEPPER)}`, 3, 86_400),
      rateLimit(`password-register:email:${hmac(email, env.OTP_PEPPER)}`, 3, 86_400),
    ]);
    if (limits.some((limit) => !limit.allowed)) {
      return authError("REGISTRATION_RATE_LIMITED", "درخواست‌های ثبت‌نام بیش از حد بود؛ بعداً دوباره امتحان کن.", 429, {
        "retry-after": String(Math.max(...limits.map((limit) => limit.retryAfter))),
      });
    }

    if (env.ADMIN_PHONE_E164 === phone) {
      return authError("ADMIN_PASSWORD_REQUIRED", "برای راه‌اندازی یا ورود مدیر، از تب ورود و رمز ADMIN_PASSWORD استفاده کن.", 409);
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await db().begin(async (tx) => {
      // نام کاربری تصادفی خوانا (مثل User25255) — جایگزین شماره در رابط کاربری.
      const username = await generateUniqueUsername(async (candidate) => {
        const [taken] = await tx<{ exists: boolean }[]>`
          select exists(select 1 from users where lower(username) = lower(${candidate})) as exists
        `;
        return Boolean(taken?.exists);
      });
      const [created] = await tx<AuthUser[]>`
        insert into users(phone_e164,email,username,status,role,last_login_at,terms_accepted_at)
        values(${phone},${email},${username},'active','user',now(),now())
        returning id,role,status,display_name,username
      `;
      await tx`insert into user_password_credentials(user_id,password_hash) values(${created.id},${passwordHash})`;
      await tx`
        insert into subscriptions(user_id,plan_id,status,starts_at,ends_at)
        select ${created.id},p.id,'active',now(),now()+interval '100 years' from plans p where p.code='free'
      `;
      await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${created.id},'account_registered_password','info',${hashIp(ip)},'{"contactVerification":"pending"}'::jsonb)`;
      return created;
    });
    return noStoreJson(await completeAuthentication(user, phone, request, false), 201);
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "INVALID_ORIGIN") return authError("INVALID_ORIGIN", "دامنه فعلی با PUBLIC_APP_URL یکسان نیست؛ آدرس نهایی سایت را در Environment اصلاح کن.", 403);
    const databaseCode = (error as { code?: string } | null)?.code;
    if (databaseCode === "23505") return authError("ACCOUNT_EXISTS", "این شماره یا ایمیل قابل ثبت نیست؛ اگر حساب داری وارد شو.", 409);
    if (["INVALID_CONTENT_TYPE", "BODY_TOO_LARGE", "EMPTY_BODY", "INVALID_JSON"].includes(code)) return authError("INVALID_REQUEST", "درخواست ثبت‌نام معتبر نیست.", 400);
    if (code.startsWith("Portal AI runtime") || code.includes("connect") || code.includes("ECONN")) return runtimeUnavailable();
    // Unexpected errors must reach the platform logs (Liara console) instead
    // of disappearing into a generic 503 — this is what makes remote debugging possible.
    console.error("[portal-auth] registration failed", {
      category: databaseCode && /^[A-Z0-9_]{2,80}$/.test(databaseCode) ? databaseCode : "REGISTRATION_FAILED",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return authError("REGISTRATION_UNAVAILABLE", "ثبت‌نام موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کن.", 503);
  }
}
