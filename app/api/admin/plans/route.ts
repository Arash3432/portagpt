import { z } from "zod";
import { adminMutationError, adminReadError, requireAdminRead, writeAdminAudit } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { requireElevatedAdmin } from "../../../../lib/session";

export const runtime="nodejs";
const budget=z.number().min(0.000001).max(10_000).nullable();
const policySchema=z.object({totalHourlyUsd:budget,totalDailyUsd:budget,totalWeeklyUsd:budget,textHourlyUsd:budget,textDailyUsd:budget,textWeeklyUsd:budget,imageHourlyUsd:budget,imageDailyUsd:budget,imageWeeklyUsd:budget});
const schema=z.object({code:z.enum(["free","starter","plus","pro","ultra"]),title:z.string().min(2).max(80).optional(),monthlyPriceToman:z.number().int().min(0).max(1_000_000_000).optional(),textCredit3h:z.number().int().min(1).max(1_000_000).optional(),textCreditWeekly:z.number().int().min(1).max(10_000_000).optional(),imageCreditLimit:z.number().int().min(0).max(100_000).optional(),imageResetInterval:z.literal("week").optional(),fileLimitPerMessage:z.number().int().min(0).max(15).optional(),enabled:z.boolean().optional(),paymentEnabled:z.boolean().optional(),policy:policySchema.optional()});

type PlanRow={code:string;title:string;monthly_price_toman:number;text_credit_3h:number;text_credit_weekly:number;image_credit_limit:number;image_reset_interval:string;file_limit_per_message:number;enabled:boolean;payment_enabled:boolean;total_hourly_micro_usd:number|null;total_daily_micro_usd:number|null;total_weekly_micro_usd:number|null;text_hourly_micro_usd:number|null;text_daily_micro_usd:number|null;text_weekly_micro_usd:number|null;image_hourly_micro_usd:number|null;image_daily_micro_usd:number|null;image_weekly_micro_usd:number|null;updated_at:string};
const list=()=>db()<PlanRow[]>`select p.code,p.title,p.monthly_price_toman,p.text_credit_3h,p.text_credit_weekly,p.image_credit_limit,p.image_reset_interval,p.file_limit_per_message,p.enabled,p.payment_enabled,policy.total_hourly_micro_usd,policy.total_daily_micro_usd,policy.total_weekly_micro_usd,policy.text_hourly_micro_usd,policy.text_daily_micro_usd,policy.text_weekly_micro_usd,policy.image_hourly_micro_usd,policy.image_daily_micro_usd,policy.image_weekly_micro_usd,p.updated_at from plans p left join plan_usage_policies policy on policy.plan_code=p.code order by p.monthly_price_toman`;
const micro=(value:number|null)=>value===null?null:Math.round(value*1_000_000);

export async function GET(request:Request){try{await requireAdminRead(request);return noStoreJson({plans:await list()});}catch(error){return adminReadError(error);}}

export async function PATCH(request:Request){
  try{
    assertSafeMutation(request);const admin=await requireElevatedAdmin(request);const parsed=schema.safeParse(await parseJsonBody(request,10_000));if(!parsed.success)return jsonError("تنظیمات پلن معتبر نیست.",400);
    const sql=db();const before=(await sql<PlanRow[]>`select p.*,policy.total_hourly_micro_usd,policy.total_daily_micro_usd,policy.total_weekly_micro_usd,policy.text_hourly_micro_usd,policy.text_daily_micro_usd,policy.text_weekly_micro_usd,policy.image_hourly_micro_usd,policy.image_daily_micro_usd,policy.image_weekly_micro_usd from plans p left join plan_usage_policies policy on policy.plan_code=p.code where p.code=${parsed.data.code}`)[0];if(!before)return jsonError("پلن پیدا نشد.",404);
    if(parsed.data.code==="free"&&parsed.data.enabled===false)return jsonError("پلن پایه Free قابل خاموش‌کردن نیست.",400);
    const price=parsed.data.monthlyPriceToman??Number(before.monthly_price_toman);if(parsed.data.code==="free"&&price!==0)return jsonError("پلن رایگان نمی‌تواند قیمت فروش داشته باشد.",400);
    const p=parsed.data.policy;const policy={
      totalHourly:p?micro(p.totalHourlyUsd):before.total_hourly_micro_usd,totalDaily:p?micro(p.totalDailyUsd):before.total_daily_micro_usd,totalWeekly:p?micro(p.totalWeeklyUsd):before.total_weekly_micro_usd,
      textHourly:p?micro(p.textHourlyUsd):before.text_hourly_micro_usd,textDaily:p?micro(p.textDailyUsd):before.text_daily_micro_usd,textWeekly:p?micro(p.textWeeklyUsd):before.text_weekly_micro_usd,
      imageHourly:p?micro(p.imageHourlyUsd):before.image_hourly_micro_usd,imageDaily:p?micro(p.imageDailyUsd):before.image_daily_micro_usd,imageWeekly:p?micro(p.imageWeeklyUsd):before.image_weekly_micro_usd,
    };
    if(![policy.totalHourly,policy.totalDaily,policy.totalWeekly].some((value)=>value!==null)||![policy.textHourly,policy.textDaily,policy.textWeekly].some((value)=>value!==null)||![policy.imageHourly,policy.imageDaily,policy.imageWeekly].some((value)=>value!==null))return jsonError("برای هزینه کل، متن و تصویر حداقل یک سقف لازم است.",400);
    for(const limits of [[policy.totalHourly,policy.totalDaily,policy.totalWeekly],[policy.textHourly,policy.textDaily,policy.textWeekly],[policy.imageHourly,policy.imageDaily,policy.imageWeekly]])for(let index=1;index<limits.length;index++)if(limits[index-1]!==null&&limits[index]!==null&&Number(limits[index-1])>Number(limits[index]))return jsonError("سقف ساعتی، روزانه و هفتگی باید به ترتیب غیرکاهشی باشند.",400);
    await sql.begin(async(tx)=>{
      await tx`update plans set title=${parsed.data.title??before.title},monthly_price_toman=${price},text_credit_3h=${parsed.data.textCredit3h??Number(before.text_credit_3h)},text_credit_weekly=${parsed.data.textCreditWeekly??Number(before.text_credit_weekly)},image_credit_limit=${parsed.data.imageCreditLimit??Number(before.image_credit_limit)},image_reset_interval='week',file_limit_per_message=${parsed.data.fileLimitPerMessage??Number(before.file_limit_per_message)},enabled=${parsed.data.enabled??before.enabled},payment_enabled=${parsed.data.paymentEnabled??before.payment_enabled},updated_at=now() where code=${parsed.data.code}`;
      await tx`insert into plan_usage_policies(plan_code,total_hourly_micro_usd,total_daily_micro_usd,total_weekly_micro_usd,text_hourly_micro_usd,text_daily_micro_usd,text_weekly_micro_usd,image_hourly_micro_usd,image_daily_micro_usd,image_weekly_micro_usd,updated_by) values(${parsed.data.code},${policy.totalHourly},${policy.totalDaily},${policy.totalWeekly},${policy.textHourly},${policy.textDaily},${policy.textWeekly},${policy.imageHourly},${policy.imageDaily},${policy.imageWeekly},${admin.userId}) on conflict(plan_code) do update set total_hourly_micro_usd=excluded.total_hourly_micro_usd,total_daily_micro_usd=excluded.total_daily_micro_usd,total_weekly_micro_usd=excluded.total_weekly_micro_usd,text_hourly_micro_usd=excluded.text_hourly_micro_usd,text_daily_micro_usd=excluded.text_daily_micro_usd,text_weekly_micro_usd=excluded.text_weekly_micro_usd,image_hourly_micro_usd=excluded.image_hourly_micro_usd,image_daily_micro_usd=excluded.image_daily_micro_usd,image_weekly_micro_usd=excluded.image_weekly_micro_usd,updated_by=excluded.updated_by,updated_at=now()`;
    });
    await writeAdminAudit({adminUserId:admin.userId,action:"plan.update",request,targetType:"plan",targetId:parsed.data.code,before,after:{...parsed.data,policy}});return noStoreJson({ok:true,plan:(await list()).find((plan)=>plan.code===parsed.data.code)});
  }catch(error){return adminMutationError(error,"تنظیمات پلن ذخیره نشد.");}
}
