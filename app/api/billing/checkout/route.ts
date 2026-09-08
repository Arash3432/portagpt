import { z } from "zod";
import { db } from "../../../../lib/db";
import { getEnv } from "../../../../lib/env";
import { requestError, jsonError, parseJsonBody } from "../../../../lib/http";
import { paidPlansReady } from "../../../../lib/quotas";
import { assertSafeMutation } from "../../../../lib/security";
import { requireSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    await requireSession(request);
    const parsed = z.object({ plan: z.enum(["starter", "plus", "pro", "ultra"]) }).safeParse(await parseJsonBody(request, 2_000));
    if (!parsed.success) return jsonError("پلن معتبر نیست.", 400);
    if (getEnv().PAYMENTS_ENABLED !== "true" || !(await paidPlansReady(parsed.data.plan))) return jsonError("پرداخت آزمایشی است یا حاشیه امن این پلن هنوز تأیید نشده است.", 503);
    const plans = await db()<Array<{ payment_enabled: boolean }>>`select payment_enabled from plans where code=${parsed.data.plan}`;
    if (!plans[0]?.payment_enabled) return jsonError("فروش این پلن هنوز توسط مدیر فعال نشده است.", 503);
    return jsonError("برای فعال‌سازی پرداخت، قرارداد درگاه و مسیر تأیید تراکنش باید ثبت شود.", 501);
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    if (error instanceof Error && error.message === "UNAUTHORIZED") return jsonError("ورود لازم است.", 401);
    return jsonError("پرداخت در دسترس نیست.", 503);
  }
}
