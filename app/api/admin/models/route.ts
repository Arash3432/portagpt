import { z } from "zod";
import { adminMutationError, adminReadError, requireAdminRead, writeAdminAudit } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody } from "../../../../lib/http";
import { invalidateModelCache } from "../../../../lib/models";
import { assertSafeMutation } from "../../../../lib/security";
import { requireElevatedAdmin } from "../../../../lib/session";

export const runtime="nodejs";
const schema=z.object({
  alias:z.string().regex(/^[a-z0-9-]+$/),displayName:z.string().min(2).max(100).optional(),description:z.string().max(220).optional(),
  providerModel:z.string().min(1).max(160).optional(),enabled:z.boolean().optional(),inputUsdPerMillion:z.number().min(0).max(1000).optional(),
  outputUsdPerMillion:z.number().min(0).max(5000).optional(),imageUsd:z.number().min(0).max(100).optional(),imageCredits:z.number().int().min(1).max(100).optional(),
  imageSize:z.string().max(24).nullable().optional(),imageQuality:z.enum(["low","medium","high","auto"]).nullable().optional(),maxOutputTokens:z.number().int().min(128).max(131072).optional(),
  messageCredits:z.number().int().min(1).max(100).optional(),minimumPlanRank:z.number().int().min(0).max(4).optional(),costMultiplier:z.number().min(1).max(3).optional(),fallbackAlias:z.string().regex(/^[a-z0-9-]+$/).nullable().optional(),
});

type Row={alias:string;display_name:string;description:string;provider_model:string;type:"text"|"image";enabled:boolean;input_usd_per_million:string;output_usd_per_million:string;image_usd:string;image_credits:number;message_credits:number;display_order:number;image_size:string|null;image_quality:string|null;max_output_tokens:number;minimum_plan_rank:number;cost_multiplier:string;is_default:boolean;fallback_alias:string|null;pricing_source_url:string|null;pricing_checked_at:string|null;updated_at:string};
const query=()=>db()<Row[]>`select alias,display_name,description,provider_model,type,enabled,input_usd_per_million,output_usd_per_million,image_usd,image_credits,message_credits,display_order,image_size,image_quality,max_output_tokens,minimum_plan_rank,cost_multiplier,is_default,fallback_alias,pricing_source_url,pricing_checked_at,updated_at from runtime_models order by case when alias='sirius' then 0 when split_part(provider_model,'/',1)='z-ai' then 10 when split_part(provider_model,'/',1)='moonshotai' then 20 when split_part(provider_model,'/',1)='anthropic' then 30 when split_part(provider_model,'/',1)='openai' then 40 when split_part(provider_model,'/',1)='google' then 50 when split_part(provider_model,'/',1)='x-ai' then 60 else 90 end,display_order,display_name`;

export async function GET(request:Request){try{await requireAdminRead(request);return noStoreJson({models:await query()});}catch(error){return adminReadError(error);}}

export async function PATCH(request:Request){
  try{
    assertSafeMutation(request);const admin=await requireElevatedAdmin(request);const parsed=schema.safeParse(await parseJsonBody(request,10_000));
    if(!parsed.success)return jsonError("تنظیمات مدل معتبر نیست.",400);
    const sql=db();const before=(await sql<Row[]>`select * from runtime_models where alias=${parsed.data.alias}`)[0];if(!before)return jsonError("مدل پیدا نشد.",404);
    if(before.alias==="sirius"&&parsed.data.enabled===false)return jsonError("مدل پیش‌فرض Sirius قابل غیرفعال‌سازی نیست.",400);
    if(before.alias!=="sirius"&&parsed.data.fallbackAlias!==undefined)return jsonError("مدل جایگزین فقط برای Sirius مجاز است.",400);
    const next={
      displayName:parsed.data.displayName??before.display_name,description:parsed.data.description??before.description,providerModel:parsed.data.providerModel??before.provider_model,
      enabled:parsed.data.enabled??before.enabled,inputUsdPerMillion:parsed.data.inputUsdPerMillion??Number(before.input_usd_per_million),outputUsdPerMillion:parsed.data.outputUsdPerMillion??Number(before.output_usd_per_million),
      imageUsd:parsed.data.imageUsd??Number(before.image_usd),imageCredits:parsed.data.imageCredits??Number(before.image_credits),imageSize:parsed.data.imageSize===undefined?before.image_size:parsed.data.imageSize,
      imageQuality:parsed.data.imageQuality===undefined?before.image_quality:parsed.data.imageQuality,maxOutputTokens:parsed.data.maxOutputTokens??Number(before.max_output_tokens),messageCredits:parsed.data.messageCredits??Number(before.message_credits),minimumPlanRank:parsed.data.minimumPlanRank??Number(before.minimum_plan_rank),
      costMultiplier:parsed.data.costMultiplier??Number(before.cost_multiplier),fallbackAlias:parsed.data.fallbackAlias===undefined?before.fallback_alias:parsed.data.fallbackAlias,
    };
    if(before.alias==="sirius"&&next.minimumPlanRank!==0)return jsonError("Sirius باید برای پلن رایگان در دسترس بماند.",400);
    if(next.enabled&&(before.type==="text"?(next.inputUsdPerMillion<=0||next.outputUsdPerMillion<=0):next.imageUsd<=0))return jsonError("مدل فعال باید قیمت محافظتی معتبر داشته باشد.",400);
    if(!next.enabled&&before.enabled){const counts=await sql<Array<{count:string;referenced:string}>>`select count(*) filter(where type=${before.type} and enabled)::text as count,count(*) filter(where fallback_alias=${before.alias} and enabled)::text as referenced from runtime_models`;const minimum=before.type==="text"?5:2;if(Number(counts[0]?.count||0)<=minimum||Number(counts[0]?.referenced||0)>0)return jsonError("این مدل برای حداقل کاتالوگ یا fallback لازم است و فعلاً قابل خاموش‌کردن نیست.",400);}
    if(next.fallbackAlias){const fallback=await sql<Array<{type:string;enabled:boolean;minimum_plan_rank:number}>>`select type,enabled,minimum_plan_rank from runtime_models where alias=${next.fallbackAlias}`;if(!fallback[0]||fallback[0].type!=="text"||!fallback[0].enabled||fallback[0].minimum_plan_rank!==0||next.fallbackAlias==="sirius")return jsonError("fallback باید یک مدل متنی فعال و در دسترس پلن رایگان باشد.",400);}
    await sql`update runtime_models set display_name=${next.displayName},description=${next.description},provider_model=${next.providerModel},enabled=${next.enabled},input_usd_per_million=${next.inputUsdPerMillion},output_usd_per_million=${next.outputUsdPerMillion},image_usd=${next.imageUsd},image_credits=${next.imageCredits},message_credits=${next.messageCredits},image_size=${next.imageSize},image_quality=${next.imageQuality},max_output_tokens=${next.maxOutputTokens},minimum_plan_rank=${next.minimumPlanRank},cost_multiplier=${next.costMultiplier},fallback_alias=${next.fallbackAlias},pricing_checked_at=case when provider_model<>${next.providerModel} or input_usd_per_million<>${next.inputUsdPerMillion} or output_usd_per_million<>${next.outputUsdPerMillion} or image_usd<>${next.imageUsd} then now() else pricing_checked_at end,updated_by=${admin.userId},updated_at=now() where alias=${parsed.data.alias}`;
    invalidateModelCache();await writeAdminAudit({adminUserId:admin.userId,action:"model.update",request,targetType:"model",targetId:parsed.data.alias,before,after:next});
    return noStoreJson({ok:true,model:(await query()).find((model)=>model.alias===parsed.data.alias)});
  }catch(error){return adminMutationError(error,"تنظیمات مدل ذخیره نشد.");}
}
