import { z } from "zod";
import { db } from "../../../../lib/db";
import { getEnv } from "../../../../lib/env";
import { authError, jsonError, noStoreJson, parseJsonBody, requestError } from "../../../../lib/http";
import { hashPassword, passwordPolicyError, verifyPassword } from "../../../../lib/password";
import { rateLimit } from "../../../../lib/redis";
import { assertSafeMutation, getClientIp, hashIp, hmac } from "../../../../lib/security";
import { requireSession } from "../../../../lib/session";

export const runtime = "nodejs";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128), confirmation: z.string().min(1).max(128) }).strict();

const messages: Record<string, string> = {
  PASSWORD_TOO_SHORT: "رمز تازه باید حداقل ۱۰ نویسه داشته باشد.",
  PASSWORD_TOO_LONG: "رمز تازه بیش از حد طولانی است.",
  PASSWORD_NEEDS_LETTER_AND_NUMBER: "رمز تازه باید حداقل یک حرف و یک عدد داشته باشد.",
  PASSWORD_TOO_COMMON: "رمز تازه بیش از حد قابل حدس است.",
};

export async function PATCH(request: Request) {
  try {
    assertSafeMutation(request);
    const session = await requireSession(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 3_000));
    if (!parsed.success) return jsonError("اطلاعات رمز عبور کامل نیست.", 400);
    if (parsed.data.newPassword !== parsed.data.confirmation) return authError("PASSWORD_MISMATCH", "رمز تازه و تکرار آن یکسان نیستند.", 400);
    const policy = passwordPolicyError(parsed.data.newPassword);
    if (policy) return authError(policy, messages[policy], 400);
    const limited = await rateLimit(`password-change:${hmac(session.userId, getEnv().OTP_PEPPER)}`, 5, 3600);
    if (!limited.allowed) return jsonError("تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کن.", 429, { "retry-after": String(limited.retryAfter) });
    const [credential] = await db()<Array<{ password_hash: string }>>`select password_hash from user_password_credentials where user_id=${session.userId}`;
    if (!await verifyPassword(parsed.data.currentPassword, credential?.password_hash)) return authError("INVALID_CURRENT_PASSWORD", "رمز فعلی درست نیست.", 401);
    const nextHash = await hashPassword(parsed.data.newPassword);
    await db().begin(async (tx) => {
      const changed = await tx<Array<{ user_id: string }>>`
        update user_password_credentials set password_hash=${nextHash},password_changed_at=now()
        where user_id=${session.userId} and password_hash=${credential.password_hash}
        returning user_id
      `;
      if (!changed.length) throw new Error("PASSWORD_CHANGED_CONCURRENTLY");
      await tx`update sessions set revoked_at=now() where user_id=${session.userId} and id<>${session.sessionId} and revoked_at is null`;
      await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${session.userId},'password_changed','info',${hashIp(getClientIp(request))},'{}'::jsonb)`;
    });
    return noStoreJson({ ok: true });
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    if (error instanceof Error && error.message === "PASSWORD_CHANGED_CONCURRENTLY") return authError("PASSWORD_CHANGED_CONCURRENTLY", "رمز در نشست دیگری تغییر کرده؛ دوباره با رمز فعلی تلاش کن.", 409);
    return jsonError("رمز عبور تغییر نکرد.", 503);
  }
}
