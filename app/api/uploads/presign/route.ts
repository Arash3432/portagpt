import { z } from "zod";
import { requestError, jsonError, noStoreJson, parseJsonBody, runtimeUnavailable } from "../../../../lib/http";
import { rateLimit } from "../../../../lib/redis";
import { assertSafeMutation } from "../../../../lib/security";
import { requireSession } from "../../../../lib/session";
import { createUploadPlans } from "../../../../lib/storage";

export const runtime = "nodejs";
const schema = z.object({ files: z.array(z.object({ name: z.string().min(1).max(200), type: z.string().min(1).max(150), size: z.number().int().positive().max(50 * 1024 * 1024) })).min(1).max(15) });

export async function POST(request: Request) {
  try {
    assertSafeMutation(request); const session = await requireSession(request);
    const limited = await rateLimit(`upload:${session.userId}`, session.plan === "free" ? 6 : 30, 3600);
    if (!limited.allowed) return jsonError("سقف بارگذاری این بازه پر شده است.", 429);
    const parsed = schema.safeParse(await parseJsonBody(request,20_000)); if (!parsed.success) return jsonError("مشخصات فایل معتبر نیست.", 400);
    const planLimit = session.plan === "free" ? 3 : session.plan === "ultra" ? 15 : 10;
    if (parsed.data.files.length > planLimit || parsed.data.files.reduce((sum, f) => sum + f.size, 0) > 50 * 1024 * 1024) return jsonError("تعداد یا حجم فایل‌ها بیشتر از سقف پلن است.", 413);
    return noStoreJson({ uploads: await createUploadPlans(session.userId, parsed.data.files, session.plan) });
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "UNAUTHORIZED") return jsonError("ورود لازم است.", 401);
    if (code === "UNSUPPORTED_FILE_TYPE") return jsonError("این نوع فایل مجاز نیست.", 415);
    if (code === "DAILY_FILE_LIMIT") return jsonError("سقف تعداد فایل روزانه پلن پر شده است.", 429);
    if (code === "DAILY_STORAGE_LIMIT" || code === "TOTAL_STORAGE_LIMIT") return jsonError("سقف فضای فایل پلن پر شده است؛ گفتگوهای دارای فایل قدیمی را حذف کن یا پلن را ارتقا بده.", 429);
    if (code === "STORAGE_NOT_CONFIGURED" || code.startsWith("Portal AI runtime")) return runtimeUnavailable();
    return jsonError("آماده‌سازی بارگذاری انجام نشد.", 503);
  }
}
