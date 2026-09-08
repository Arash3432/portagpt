import { z } from "zod";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody, requestError } from "../../../../lib/http";
import { assertSafeMutation, getClientIp, hashIp } from "../../../../lib/security";
import { getSession, requireSession } from "../../../../lib/session";

export const runtime = "nodejs";

function deviceName(userAgent: string | null) {
  const value = userAgent || "";
  const device = /Android/i.test(value) ? "گوشی اندرویدی" : /iPhone|iPad/i.test(value) ? "دستگاه اپل" : /Windows/i.test(value) ? "رایانه ویندوزی" : /Macintosh/i.test(value) ? "رایانه مک" : "دستگاه ناشناس";
  const browser = /Edg\//i.test(value) ? "Edge" : /OPR\//i.test(value) ? "Opera" : /Chrome\//i.test(value) ? "Chrome" : /Firefox\//i.test(value) ? "Firefox" : /Safari\//i.test(value) ? "Safari" : "مرورگر";
  return `${device} · ${browser}`;
}

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return jsonError("ورود لازم است.", 401);
    const rows = await db()<Array<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string }>>`
      select id,user_agent,created_at,last_seen_at,expires_at from sessions
      where user_id=${session.userId} and revoked_at is null and expires_at>now()
      order by last_seen_at desc limit 20
    `;
    return noStoreJson({ sessions: rows.map((row) => ({ id: row.id, device: deviceName(row.user_agent), createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, current: row.id === session.sessionId })) });
  } catch { return jsonError("دستگاه‌های فعال در دسترس نیستند.", 503); }
}

export async function DELETE(request: Request) {
  try {
    assertSafeMutation(request);
    const session = await requireSession(request);
    const parsed = z.object({ sessionId: z.string().uuid().optional(), others: z.boolean().optional() }).strict().safeParse(await parseJsonBody(request, 1_000));
    if (!parsed.success || (!parsed.data.sessionId && !parsed.data.others)) return jsonError("درخواست معتبر نیست.", 400);
    if (parsed.data.sessionId === session.sessionId) return jsonError("برای خروج از دستگاه فعلی از دکمه خروج حساب استفاده کن.", 400);
    await db().begin(async (tx) => {
      if (parsed.data.others) {
        await tx`update sessions set revoked_at=now() where user_id=${session.userId} and id<>${session.sessionId} and revoked_at is null`;
      } else {
        await tx`update sessions set revoked_at=now() where id=${parsed.data.sessionId!} and user_id=${session.userId} and revoked_at is null`;
      }
      await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${session.userId},'session_revoked','info',${hashIp(getClientIp(request))},${tx.json({ scope: parsed.data.others ? "others" : "single" })})`;
    });
    return noStoreJson({ ok: true });
  } catch (error) { return requestError(error) || jsonError("خروج دستگاه انجام نشد.", 503); }
}
