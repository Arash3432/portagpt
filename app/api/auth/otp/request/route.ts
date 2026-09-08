import { z } from "zod";
import { getEnv, isProduction } from "../../../../../lib/env";
import { authError, jsonError, noStoreJson, parseJsonBody, requestError, runtimeUnavailable } from "../../../../../lib/http";
import { rateLimit, redis } from "../../../../../lib/redis";
import { assertSafeMutation, getClientIp, hmac, normalizeIranianPhone, randomOtp } from "../../../../../lib/security";
import { isSmsConfigured, sendOtp } from "../../../../../lib/sms";

export const runtime = "nodejs";

const schema = z.object({ phone: z.string().min(7).max(30) });

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const parsed = schema.safeParse(await parseJsonBody(request,2_000));
    if (!parsed.success) return jsonError("شماره موبایل معتبر نیست.", 400);
    const phone = normalizeIranianPhone(parsed.data.phone);
    if (!phone) return jsonError("شماره موبایل ایران را به‌درستی وارد کن.", 400);
    if (!isSmsConfigured()) return authError("PASSWORD_FALLBACK_REQUIRED", "پیامک فعال نیست؛ با شماره موبایل و رمز عبور وارد شو.", 409);
    const ip = getClientIp(request);
    const [byIp, byPhone] = await Promise.all([
      rateLimit(`otp:ip:${hmac(ip, getEnv().OTP_PEPPER)}`, 100, 3600),
      rateLimit(`otp:phone:${hmac(phone, getEnv().OTP_PEPPER)}`, 3, 600),
    ]);
    if (!byIp.allowed || !byPhone.allowed) return jsonError("درخواست‌های زیادی ثبت شده؛ کمی بعد دوباره امتحان کن.", 429, { "retry-after": String(Math.max(byIp.retryAfter, byPhone.retryAfter)) });
    const code = !isProduction() && getEnv().OTP_DEV_CODE ? getEnv().OTP_DEV_CODE : randomOtp();
    const salt = crypto.randomUUID();
    const codeHash = hmac(`${phone}:${code}:${salt}`, getEnv().OTP_PEPPER);
    const otpKey = `otp:${hmac(phone, getEnv().OTP_PEPPER)}`;
    await (await redis()).multi().hSet(otpKey, { hash: codeHash, salt, attempts: "0" }).expire(otpKey, 300).exec();
    try { await sendOtp(phone, code!); } catch { await (await redis()).del(otpKey); return authError("PASSWORD_FALLBACK_REQUIRED", "ارسال پیامک در دسترس نیست؛ با رمز عبور وارد شو.", 409); }
    return noStoreJson({ ok: true, expiresIn: 300, ...(isProduction() ? {} : { devCode: getEnv().OTP_DEV_CODE }) });
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    if (error instanceof Error && error.message.includes("Portal AI runtime configuration is incomplete")) return runtimeUnavailable();
    return jsonError("ارسال کد موقتاً ممکن نیست.", 503);
  }
}
