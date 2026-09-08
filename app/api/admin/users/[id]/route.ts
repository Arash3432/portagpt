import { z } from "zod";
import { adminMutationError, adminReadError, requireAdminRead, writeAdminAudit } from "../../../../../lib/admin";
import { db } from "../../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody } from "../../../../../lib/http";
import { assertSafeMutation } from "../../../../../lib/security";
import { requireElevatedAdmin } from "../../../../../lib/session";

export const runtime="nodejs";
const schema=z.discriminatedUnion("action",[
  z.object({action:z.literal("status"),status:z.enum(["active","suspended"]),reason:z.string().min(3).max(300).nullable().optional()}),
  z.object({action:z.literal("plan"),planCode:z.enum(["free","starter","plus","pro","ultra"]),durationDays:z.number().int().min(1).max(366).default(30)}),
  z.object({action:z.literal("note"),note:z.string().min(1).max(2000)}),
  z.object({action:z.literal("tags"),tags:z.array(z.string().min(1).max(32)).max(12),riskScore:z.number().int().min(0).max(100)}),
  z.object({action:z.literal("revokeSessions")}),
]);

async function loadUser(id:string){
  const sql=db();const users=await sql<Array<{id:string;phone_e164:string;email:string|null;phone_verified_at:string|null;email_verified_at:string|null;display_name:string|null;locale:string;status:string;role:string;suspended_reason:string|null;risk_score:number;admin_tags:string[];last_login_at:string|null;created_at:string;updated_at:string;plan:string;plan_ends_at:string|null;conversation_count:string;message_count:string;image_count:string;storage_bytes:string;cost_total:string;active_sessions:string}>>`
    select u.id,u.phone_e164,u.email,u.phone_verified_at,u.email_verified_at,u.display_name,u.locale,u.status,u.role,u.suspended_reason,u.risk_score,u.admin_tags,u.last_login_at,u.created_at,u.updated_at,
           coalesce(current_plan.code,'free') as plan,current_plan.ends_at as plan_ends_at,
           (select count(*)::text from conversations where user_id=u.id and deleted_at is null) as conversation_count,
           (select count(*)::text from messages where user_id=u.id) as message_count,
           (select count(*)::text from image_credit_ledger where user_id=u.id and status='settled') as image_count,
           coalesce((select sum(size_bytes) from files where user_id=u.id and deleted_at is null),0)::text as storage_bytes,
           coalesce((select sum(actual_cost_micro_usd) from usage_ledger where user_id=u.id and status='settled'),0)::text as cost_total,
           (select count(*)::text from sessions where user_id=u.id and revoked_at is null and expires_at>now()) as active_sessions
    from users u left join lateral(select p.code,s.ends_at from subscriptions s join plans p on p.id=s.plan_id where s.user_id=u.id and s.status='active' and s.ends_at>now() order by p.monthly_price_toman desc,s.ends_at desc limit 1) current_plan on true where u.id=${id}`;
  if(!users[0])return null;
  const [conversations,security,notes,payments,usage]=await Promise.all([
    sql<Array<{id:string;title:string;model_alias:string;updated_at:string}>>`select id,title,model_alias,updated_at from conversations where user_id=${id} and deleted_at is null order by updated_at desc limit 12`,
    sql<Array<{id:number;event_type:string;severity:string;details:unknown;created_at:string;resolved_at:string|null}>>`select id,event_type,severity,details,created_at,resolved_at from security_events where user_id=${id} order by created_at desc limit 20`,
    sql<Array<{id:number;note:string;created_at:string;admin_phone:string}>>`select n.id,n.note,n.created_at,concat(left(a.phone_e164,5),'•••',right(a.phone_e164,3)) as admin_phone from user_admin_notes n join users a on a.id=n.admin_user_id where n.user_id=${id} order by n.created_at desc limit 20`,
    sql<Array<{id:string;amount_toman:number;status:string;gateway:string;created_at:string;paid_at:string|null;plan:string}>>`select t.id,t.amount_toman,t.status,t.gateway,t.created_at,t.paid_at,p.code as plan from payment_transactions t join plans p on p.id=t.plan_id where t.user_id=${id} order by t.created_at desc limit 20`,
    sql<Array<{day:string;cost:string;requests:string}>>`select date_trunc('day',created_at)::date::text as day,sum(actual_cost_micro_usd)::text as cost,count(*)::text as requests from usage_ledger where user_id=${id} and status='settled' and created_at>now()-interval '14 days' group by 1 order by 1`,
  ]);
  const user=users[0];return{user:{...user,conversationCount:Number(user.conversation_count),messageCount:Number(user.message_count),imageCount:Number(user.image_count),storageBytes:Number(user.storage_bytes),costTotalUsd:Number(user.cost_total)/1e6,activeSessions:Number(user.active_sessions)},conversations,security,notes,payments,usage:usage.map((row)=>({day:row.day,costUsd:Number(row.cost)/1e6,requests:Number(row.requests)}))};
}

export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{await requireAdminRead(request);const{id}=await context.params;if(!z.string().uuid().safeParse(id).success)return jsonError("کاربر پیدا نشد.",404);const result=await loadUser(id);return result?noStoreJson(result):jsonError("کاربر پیدا نشد.",404);}catch(error){return adminReadError(error);}}

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSafeMutation(request);const admin=await requireElevatedAdmin(request);const{id}=await context.params;if(!z.string().uuid().safeParse(id).success)return jsonError("کاربر پیدا نشد.",404);const parsed=schema.safeParse(await parseJsonBody(request,5_000));if(!parsed.success)return jsonError("عملیات کاربر معتبر نیست.",400);
    if(id===admin.userId&&["status","plan","revokeSessions"].includes(parsed.data.action))return jsonError("این عملیات روی حساب مدیر جاری مجاز نیست.",400);
    const sql=db();const before=await loadUser(id);if(!before)return jsonError("کاربر پیدا نشد.",404);
    await sql.begin(async(tx)=>{
      if(parsed.data.action==="status"){
        await tx`update users set status=${parsed.data.status},suspended_reason=${parsed.data.status==="suspended"?(parsed.data.reason||"manual_admin_review"):null},updated_at=now() where id=${id}`;
        if(parsed.data.status==="suspended")await tx`update sessions set revoked_at=now() where user_id=${id} and revoked_at is null`;
      }else if(parsed.data.action==="plan"){
        await tx`update subscriptions set status='cancelled',updated_at=now() where user_id=${id} and status='active' and plan_id in(select id from plans where code<>'free')`;
        if(parsed.data.planCode!=="free")await tx`insert into subscriptions(user_id,plan_id,status,source,starts_at,ends_at,external_reference) select ${id},p.id,'active','admin',now(),now()+make_interval(days=>${parsed.data.durationDays}),${`admin:${crypto.randomUUID()}`} from plans p where p.code=${parsed.data.planCode}`;
      }else if(parsed.data.action==="note")await tx`insert into user_admin_notes(user_id,admin_user_id,note) values(${id},${admin.userId},${parsed.data.note})`;
      else if(parsed.data.action==="tags")await tx`update users set admin_tags=${parsed.data.tags},risk_score=${parsed.data.riskScore},updated_at=now() where id=${id}`;
      else await tx`update sessions set revoked_at=now() where user_id=${id} and revoked_at is null`;
    });
    const after=await loadUser(id);await writeAdminAudit({adminUserId:admin.userId,action:`user.${parsed.data.action}`,request,targetType:"user",targetId:id,before:before.user,after:after?.user});return noStoreJson({ok:true,...after});
  }catch(error){return adminMutationError(error,"عملیات کاربر انجام نشد.");}
}
