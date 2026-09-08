import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, requestError } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { clearSessionCookie, requireSession } from "../../../../lib/session";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const session = await requireSession(request);
    await db()`update sessions set revoked_at=now() where id=${session.sessionId}`;
    await clearSessionCookie();
    return noStoreJson({ ok: true });
  } catch (error) {
    // An already expired/revoked session can still be cleared, allowing logout
    // from another tab or after a password change to complete cleanly.
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      await clearSessionCookie();
      return noStoreJson({ ok: true });
    }
    return requestError(error) || jsonError("خروج حساب انجام نشد؛ دوباره تلاش کن.", 503);
  }
}
