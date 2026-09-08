import { randomUUID } from "node:crypto";
import { z } from "zod";
import { flagAbuse } from "../../../lib/abuse";
import { db } from "../../../lib/db";
import { jsonError, parseJsonBody, requestError, runtimeUnavailable } from "../../../lib/http";
import { enqueueImage } from "../../../lib/image-queue";
import { effectiveImageUsd, resolveModel } from "../../../lib/models";
import { releaseImageCredits, releaseTextReservation, reserveImageCredits, reserveTextCost } from "../../../lib/quotas";
import { rateLimit } from "../../../lib/redis";
import { assertSafeMutation } from "../../../lib/security";
import { requireSession } from "../../../lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;
const schema = z.object({ prompt: z.string().min(3).max(5000), model: z.string().regex(/^[a-z0-9-]+$/), conversationId: z.string().uuid().nullable().optional() });

export async function POST(request: Request) {
  const requestId = randomUUID();
  let reservationAttempted = false;
  try {
    assertSafeMutation(request);
    const session = await requireSession(request);
    const limited = await rateLimit(`image:user:${session.userId}`, session.plan === "free" ? 2 : 10, 60);
    if (!limited.allowed) { await flagAbuse(session.userId,"image_rate_abuse",request,3); return jsonError("درخواست تصویر بیش از حد سریع است.", 429, { "retry-after": String(limited.retryAfter) }); }
    const parsed = schema.safeParse(await parseJsonBody(request,10_000));
    if (!parsed.success) return jsonError("توضیح تصویر یا مدل معتبر نیست.", 400);
    const model = await resolveModel(parsed.data.model, "image",session.plan);
    const costMicroUsd = Math.ceil(effectiveImageUsd(model) * 1_000_000);
    reservationAttempted = true;
    await reserveTextCost({ userId: session.userId, requestId, modelAlias: model.alias, reservedMicroUsd: costMicroUsd,kind:"image" });
    try { await reserveImageCredits({ userId: session.userId, requestId, modelAlias: model.alias, credits: model.imageCredits }); }
    catch (error) { await releaseTextReservation(requestId, "IMAGE_CREDITS"); throw error; }

    const sql=db();
    const conversationId=await sql.begin(async(tx)=>{
      let id=parsed.data.conversationId||null;
      if(id){const owned=await tx<Array<{id:string}>>`select id from conversations where id=${id} and user_id=${session.userId} and deleted_at is null`;if(!owned.length)throw new Error("CONVERSATION_NOT_FOUND");}
      else{const created=await tx<Array<{id:string}>>`insert into conversations(user_id,title,model_alias) values(${session.userId},${parsed.data.prompt.slice(0,80)},${model.alias}) returning id`;id=created[0].id;}
      await tx`insert into messages(conversation_id,user_id,role,content,model_alias) values(${id},${session.userId},'user',${parsed.data.prompt},${model.alias})`;
      await tx`insert into image_jobs (request_id,user_id,conversation_id,model_alias,prompt,status,credits,cost_micro_usd) values (${requestId},${session.userId},${id},${model.alias},${parsed.data.prompt},'queued',${model.imageCredits},${costMicroUsd})`;
      return id;
    });
    await enqueueImage({requestId,userId:session.userId,modelAlias:model.alias,prompt:parsed.data.prompt});
    return Response.json({ id: requestId, conversationId, status: "queued", statusUrl: `/api/images/${requestId}`, creditsUsed: model.imageCredits }, { status:202,headers: { "cache-control": "no-store",location:`/api/images/${requestId}` } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (reservationAttempted) await Promise.all([releaseTextReservation(requestId, code).catch(() => undefined), releaseImageCredits(requestId, code).catch(() => undefined),db()`update image_jobs set status='failed',error_code=${code.slice(0,80)},completed_at=now() where request_id=${requestId} and status in ('queued','processing')`.catch(()=>undefined)]);
    const failure = requestError(error);
    if (failure) return failure;
    if (code === "UNAUTHORIZED") return jsonError("برای ادامه وارد حساب شو.", 401);
    if (code === "CONVERSATION_NOT_FOUND") return jsonError("گفتگو پیدا نشد.", 404);
    if (code === "INVALID_CSRF" || code === "INVALID_ORIGIN") return jsonError("درخواست امنیتی معتبر نیست.", 403);
    if (code === "IMAGE_CREDITS_EXCEEDED") return jsonError("اعتبار تصویر این بازه تمام شده است.", 429);
    if (code === "MODEL_REQUIRES_HIGHER_PLAN") return jsonError("این مدل تصویر برای پلن بالاتری فعال است.", 403);
    if (code.includes("QUOTA_")) return jsonError("سهمیه هزینه این بازه تمام شده است.", 429);
    if (code === "SERVICE_PAUSED_BY_ADMIN" || code === "GLOBAL_COST_CIRCUIT_OPEN") return jsonError("سرویس برای محافظت مالی موقتاً متوقف شده است.", 503);
    if (["PLAN_USAGE_DISABLED", "STORAGE_NOT_CONFIGURED", "INVALID_MODEL_CATALOG", "MODEL_CATALOG_NOT_MIGRATED", "PROVIDER_API_KEY_NOT_CONFIGURED", "PROVIDER_DISABLED"].includes(code) || code.startsWith("Portal AI runtime")) return runtimeUnavailable();
    return jsonError("ساخت تصویر انجام نشد و اعتبار رزروشده آزاد شد.", 502);
  }
}
