import { z } from "zod";
import { adminMutationError } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { requireElevatedAdmin } from "../../../../lib/session";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    assertSafeMutation(request);
    const admin = await requireElevatedAdmin(request);
    const parsed = z.object({ paused: z.boolean() }).safeParse(await parseJsonBody(request, 2_000));
    if (!parsed.success) return jsonError("مقدار معتبر نیست.", 400);
    const sql = db();
    await sql.begin(async (tx) => {
      await tx`insert into app_settings (key,value,updated_by) values ('service_status',${sql.json({ paused: parsed.data.paused })},${admin.userId}) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`;
      await tx`insert into admin_audit_logs (admin_user_id,action,target_type,target_id,after_state) values (${admin.userId},'service.pause','setting','service_status',${sql.json({ paused: parsed.data.paused })})`;
    });
    return noStoreJson({ ok: true, paused: parsed.data.paused });
  } catch(error) { return adminMutationError(error, "تغییر وضعیت انجام نشد."); }
}
