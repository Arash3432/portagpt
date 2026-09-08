import { z } from "zod";
import { requestError, jsonError, noStoreJson, parseJsonBody, runtimeUnavailable } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { requireSession } from "../../../../lib/session";
import { completeUploads } from "../../../../lib/storage";

export const runtime = "nodejs";
const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(15) });

export async function POST(request: Request) {
  try {
    assertSafeMutation(request); const session = await requireSession(request);
    const parsed = schema.safeParse(await parseJsonBody(request,5_000)); if (!parsed.success) return jsonError("شناسه فایل معتبر نیست.", 400);
    return noStoreJson({ fileIds: await completeUploads(session.userId, parsed.data.ids) });
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "UNAUTHORIZED") return jsonError("ورود لازم است.", 401);
    if (["FILE_SIGNATURE_MISMATCH", "UPLOAD_SIZE_MISMATCH"].includes(code)) return jsonError("فایل با مشخصات اعلام‌شده مطابقت ندارد.", 422);
    if (code === "STORAGE_NOT_CONFIGURED" || code.startsWith("Portal AI runtime")) return runtimeUnavailable();
    return jsonError("تأیید فایل انجام نشد.", 503);
  }
}
