import { adminReadError, requireAdminRead } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { getEnv } from "../../../../lib/env";
import { noStoreJson } from "../../../../lib/http";
import { getClientIp } from "../../../../lib/security";

export const runtime = "nodejs";
export async function GET(request:Request) {
  try {
    await requireAdminRead(request);
    const sql = db();
    const [users, active, suspended, finance, events, paused, subscriptions, recent,topModels,trend,controls,provider] = await Promise.all([
      sql<{ count: string }[]>`select count(*)::text as count from users where status!='deleted'`,
      sql<{ count: string }[]>`select count(distinct user_id)::text as count from usage_ledger where created_at>=date_trunc('day',now())`,
      sql<{ count: string }[]>`select count(*)::text as count from users where status='suspended'`,
      sql<{ revenue: string; day_cost: string; week_cost: string }[]>`select coalesce((select sum(amount_toman) from payment_transactions where status='paid'),0)::text as revenue,coalesce((select sum(actual_cost_micro_usd) from usage_ledger where status='settled' and created_at>=date_trunc('day',now())),0)::text as day_cost,coalesce((select sum(actual_cost_micro_usd) from usage_ledger where status='settled' and created_at>=date_trunc('week',now())),0)::text as week_cost`,
      sql<{ count: string }[]>`select count(*)::text as count from security_events where severity in ('warning','critical') and created_at>now()-interval '7 days'`,
      sql<{ paused: boolean }[]>`select coalesce((value->>'paused')::boolean,false) as paused from app_settings where key='service_status'`,
      sql<Array<{ code: string; count: string }>>`
        select p.code,count(*)::text as count from (
          select distinct on (s.user_id) s.plan_id from subscriptions s
          join plans ranked on ranked.id=s.plan_id
          where s.status='active' and s.ends_at>now()
          order by s.user_id,ranked.monthly_price_toman desc,s.ends_at desc
        ) current join plans p on p.id=current.plan_id
        group by p.code,p.monthly_price_toman order by p.monthly_price_toman
      `,
      sql<Array<{ id:string; phone_masked:string; status:string; plan:string; created_at:string }>>`
        select u.id,concat(left(u.phone_e164,5),'•••',right(u.phone_e164,3)) as phone_masked,u.status,coalesce(p.code,'free') as plan,u.created_at
        from users u left join lateral (
          select s.plan_id from subscriptions s join plans ranked on ranked.id=s.plan_id
          where s.user_id=u.id and s.status='active' and s.ends_at>now()
          order by ranked.monthly_price_toman desc,s.ends_at desc limit 1
        ) s on true left join plans p on p.id=s.plan_id
        where u.status!='deleted' order by u.created_at desc limit 20
      `,
      sql<Array<{model_alias:string;requests:string;cost:string}>>`select model_alias,count(*)::text as requests,sum(actual_cost_micro_usd)::text as cost from usage_ledger where status='settled' and created_at>now()-interval '7 days' group by model_alias order by sum(actual_cost_micro_usd) desc limit 8`,
      sql<Array<{day:string;users:string;cost:string}>>`select days.day::date::text as day,coalesce(signups.users,0)::text as users,coalesce(spend.cost,0)::text as cost from generate_series(date_trunc('day',now())-interval '13 days',date_trunc('day',now()),interval '1 day') days(day) left join lateral(select count(*) as users from users where created_at>=days.day and created_at<days.day+interval '1 day') signups on true left join lateral(select sum(actual_cost_micro_usd) as cost from usage_ledger where status='settled' and created_at>=days.day and created_at<days.day+interval '1 day') spend on true order by days.day`,
      sql<Array<{value:Record<string,unknown>}>>`select value from app_settings where key='cost_controls'`,
      sql<Array<{value:Record<string,unknown>}>>`select value from app_settings where key='provider_config'`,
    ]);
    const costTodayUsd=Number(finance[0].day_cost)/1e6;const globalCap=Number(controls[0]?.value?.globalDailyCapUsd||getEnv().GLOBAL_DAILY_COST_CAP_USD);
    return noStoreJson({ currentIp:getClientIp(request), users: { total:Number(users[0].count),activeToday:Number(active[0].count),suspended:Number(suspended[0].count) }, subscriptions:subscriptions.map((r)=>({code:r.code,count:Number(r.count)})), finance:{revenueToman:Number(finance[0].revenue),costTodayUsd,costWeekUsd:Number(finance[0].week_cost)/1e6,globalDailyCapUsd:globalCap,globalUsedPercent:Math.min(100,Math.round(costTodayUsd/globalCap*100))}, security:{openEvents:Number(events[0].count),servicePaused:Boolean(paused[0]?.paused)}, provider:{status:provider[0]?.value?.lastTestStatus||'never',lastTestAt:provider[0]?.value?.lastTestAt||null},topModels:topModels.map((row)=>({alias:row.model_alias,requests:Number(row.requests),costUsd:Number(row.cost)/1e6})),trend:trend.map((row)=>({day:row.day,users:Number(row.users),costUsd:Number(row.cost)/1e6})), recentUsers:recent.map((r)=>({id:r.id,phoneMasked:r.phone_masked,status:r.status,plan:r.plan,createdAt:r.created_at})) });
  } catch (error) { return adminReadError(error); }
}
