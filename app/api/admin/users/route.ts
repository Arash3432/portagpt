import { z } from "zod";
import { adminReadError, requireAdminRead } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson } from "../../../../lib/http";

export const runtime="nodejs";
const querySchema=z.object({q:z.string().max(80).default(""),status:z.enum(["all","active","suspended","deleted"]).default("all"),plan:z.enum(["all","free","starter","plus","pro","ultra"]).default("all"),page:z.coerce.number().int().min(1).max(10000).default(1)});

export async function GET(request:Request){
  try{
    await requireAdminRead(request);const url=new URL(request.url);const parsed=querySchema.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)return jsonError("فیلتر جستجو معتبر نیست.",400);
    const {q,status,plan,page}=parsed.data;const limit=40;const offset=(page-1)*limit;const pattern=`%${q}%`;const rows=await db()<Array<{id:string;phone_e164:string;email:string|null;display_name:string|null;locale:string;status:string;role:string;risk_score:number;admin_tags:string[];last_login_at:string|null;created_at:string;plan:string;plan_ends_at:string|null;cost_30d:string;messages_30d:string;files_bytes:string;total_count:string}>>`
      select u.id,u.phone_e164,u.email,u.display_name,u.locale,u.status,u.role,u.risk_score,u.admin_tags,u.last_login_at,u.created_at,
             coalesce(current_plan.code,'free') as plan,current_plan.ends_at as plan_ends_at,
             coalesce(usage.cost_30d,0)::text as cost_30d,coalesce(activity.messages_30d,0)::text as messages_30d,
             coalesce(storage.files_bytes,0)::text as files_bytes,count(*) over()::text as total_count
      from users u
      left join lateral(select p.code,s.ends_at from subscriptions s join plans p on p.id=s.plan_id where s.user_id=u.id and s.status='active' and s.ends_at>now() order by p.monthly_price_toman desc,s.ends_at desc limit 1) current_plan on true
      left join lateral(select sum(actual_cost_micro_usd) as cost_30d from usage_ledger where user_id=u.id and status='settled' and created_at>now()-interval '30 days') usage on true
      left join lateral(select count(*) as messages_30d from messages where user_id=u.id and created_at>now()-interval '30 days') activity on true
      left join lateral(select sum(size_bytes) as files_bytes from files where user_id=u.id and deleted_at is null) storage on true
      where (${q}='' or u.phone_e164 ilike ${pattern} or coalesce(u.email,'') ilike ${pattern} or u.id::text=${q} or coalesce(u.display_name,'') ilike ${pattern})
        and (${status}='all' or u.status::text=${status})
        and (${plan}='all' or coalesce(current_plan.code,'free')=${plan})
      order by u.created_at desc limit ${limit} offset ${offset}`;
    return noStoreJson({page,pageSize:limit,total:Number(rows[0]?.total_count||0),users:rows.map((row)=>({...row,cost30dUsd:Number(row.cost_30d)/1e6,messages30d:Number(row.messages_30d),filesBytes:Number(row.files_bytes)}))});
  }catch(error){return adminReadError(error);}
}
