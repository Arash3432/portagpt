import { z } from "zod";
import { getEnv } from "../../../../lib/env";
import { jsonError, noStoreJson, parseJsonBody, requestError } from "../../../../lib/http";
import { rateLimit } from "../../../../lib/redis";
import { getClientIp, hashIp, hmac } from "../../../../lib/security";
import { requireSession } from "../../../../lib/session";
import { normalizeUsername, usernamePolicyError } from "../../../../lib/username";
import { db } from "../../../../lib/db";

export const runtime = "nodejs";

const schema = z.object({ username: z.string().min(1).max(32) }).strict();

export async function PATCH(request: Request) {
  try {
    const session = await requireSession(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 1_000));
    if (!parsed.success) return jsonError("نام کاربری ارسال‌شده معتبر نیست.", 400);

    const policyError = usernamePolicyError(parsed.data.username);
    if (policyError === "USERNAME_RESERVED") {
      return jsonError("این نام برای سیستم رزرو شده است؛ نام دیگری انتخاب کن.", 409);
    }
    const username = normalizeUsername(parsed.data.username);
    if (!username) {
      return jsonError(
        "نام کاربری باید ۳ تا ۲۴ نویسه باشد و با حرف لاتین شروع شود؛ فقط حرف، عدد و زیرخط مجاز است.",
        400,
      );
    }

    const env = getEnv();
    const limit = await rateLimit(`username-change:${hmac(session.userId, env.OTP_PEPPER)}`, 5, 3600);
    if (!limit.allowed) {
      return jsonError("تغییر نام کاربری زیاد بود؛ یک ساعت بعد دوباره امتحان کن.", 429, {
        "retry-after": String(limit.retryAfter),
      });
    }

    try {
      const [updated] = await db()<Array<{ username: string }>>`
        update users set username=${username}, updated_at=now()
        where id=${session.userId} and status='active'
        returning username
      `;
      if (!updated) return jsonError("حساب در دسترس نیست.", 403);
      await db()`insert into security_events(user_id,event_type,severity,ip_hash,details)
        values(${session.userId},'username_changed','info',${hashIp(getClientIp(request))},'{"via":"profile"}'::jsonb)`;
      return noStoreJson({ ok: true, username: updated.username });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "23505") {
        return jsonError("این نام کاربری قبلاً برداشته شده؛ نام دیگری انتخاب کن.", 409);
      }
      throw error;
    }
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    return jsonError("تغییر نام کاربری انجام نشد.", 503);
  }
}
