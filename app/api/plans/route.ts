import { db } from "../../../lib/db";
import { jsonError, noStoreJson } from "../../../lib/http";
import { paidPlanReadiness } from "../../../lib/quotas";

export const runtime="nodejs";
export async function GET(){try{const rows=await db()<Array<{code:string;title:string;monthly_price_toman:number;text_credit_3h:number;text_credit_weekly:number;image_credit_limit:number;image_reset_interval:string;file_limit_per_message:number;payment_enabled:boolean}>>`select code,title,monthly_price_toman,text_credit_3h,text_credit_weekly,image_credit_limit,image_reset_interval,file_limit_per_message,payment_enabled from plans where enabled=true order by monthly_price_toman`;const readiness=await paidPlanReadiness();return noStoreJson({plans:rows.map((p)=>({...p,checkoutAvailable:p.code==='free'||(p.payment_enabled&&Boolean(readiness[p.code]))})),paymentsMode:process.env.PAYMENTS_ENABLED==='true'?'configured':'experimental'});}catch{return jsonError("پلن‌ها در دسترس نیستند.",503)}}
