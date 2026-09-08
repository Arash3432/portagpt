import { db } from "./db";
import { getEnv } from "./env";

type WindowName = "hour" | "day" | "week";
type UsageKind = "text" | "image";

export function estimateTextReservation(inputCharacters: number, maxOutputTokens: number, inputUsdPerMillion: number, outputUsdPerMillion: number) {
  const estimatedInputTokens = Math.max(1, Math.ceil(inputCharacters / 3.2));
  return Math.max(1, Math.ceil(estimatedInputTokens * inputUsdPerMillion + maxOutputTokens * outputUsdPerMillion));
}

function windowStart(window: WindowName) {
  return `date_trunc('${window}', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran'`;
}

function threeHourStart() {
  return "(date_trunc('hour',now() at time zone 'Asia/Tehran') - ((extract(hour from now() at time zone 'Asia/Tehran')::int % 3) * interval '1 hour')) at time zone 'Asia/Tehran'";
}

export async function reserveTextCredits(input: { userId: string; requestId: string; modelAlias: string; credits: number }) {
  return db().begin(async (tx) => {
    await tx`select portal_release_stale_reservations()`;
    await tx`select pg_advisory_xact_lock(hashtext(${input.userId}))`;
    if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 100) throw new Error("INVALID_TEXT_CREDITS");
    const plans = await tx<Array<{ code: string; three_hour: number; weekly: number }>>`
      select coalesce(p.code,free_plan.code) as code,coalesce(p.text_credit_3h,free_plan.text_credit_3h) as three_hour,
             coalesce(p.text_credit_weekly,free_plan.text_credit_weekly) as weekly
      from users u cross join plans free_plan
      left join subscriptions s on s.user_id=u.id and s.status='active' and s.ends_at>now()
      left join plans p on p.id=s.plan_id
      where u.id=${input.userId} and free_plan.code='free'
      order by p.monthly_price_toman desc nulls last,s.ends_at desc nulls last limit 1`;
    const allowance = plans[0];
    if (!allowance || allowance.three_hour <= 0 || allowance.weekly <= 0) throw new Error("PLAN_USAGE_DISABLED");
    const used = await tx.unsafe<Array<{ used_3h: string; used_week: string }>>(
      `select coalesce(sum(credits) filter(where created_at>=${threeHourStart()}),0)::text as used_3h,
              coalesce(sum(credits) filter(where created_at>=${windowStart("week")}),0)::text as used_week
       from text_credit_ledger where user_id=$1 and status in ('reserved','settled')`,
      [input.userId],
    );
    const used3h = Number(used[0]?.used_3h || 0);
    const usedWeek = Number(used[0]?.used_week || 0);
    if (used3h + input.credits > allowance.three_hour) throw new Error("TEXT_CREDITS_3H_EXCEEDED");
    if (usedWeek + input.credits > allowance.weekly) throw new Error("TEXT_CREDITS_WEEKLY_EXCEEDED");
    await tx`insert into text_credit_ledger(request_id,user_id,model_alias,credits,status) values(${input.requestId},${input.userId},${input.modelAlias},${input.credits},'reserved')`;
    return { plan: allowance.code, remaining3h: allowance.three_hour-used3h-input.credits, remainingWeek: allowance.weekly-usedWeek-input.credits };
  });
}

export async function reserveTextCost(input: { userId: string; requestId: string; modelAlias: string; reservedMicroUsd: number; kind?: UsageKind }) {
  const sql = db();
  return sql.begin(async (tx) => {
    await tx`select portal_release_stale_reservations()`;
    await tx`select pg_advisory_xact_lock(hashtext(${input.userId}))`;
    const planRows = await tx<Array<{ code: string }>>`
      select coalesce(p.code,'free') as code
      from users u
      left join subscriptions s on s.user_id=u.id and s.status='active' and s.ends_at>now()
      left join plans p on p.id=s.plan_id
      where u.id=${input.userId}
      order by p.monthly_price_toman desc nulls last,s.ends_at desc nulls last limit 1
    `;
    const plan=planRows[0]?.code||"free";
    const pauseRows=await tx<{paused:boolean}[]>`select coalesce((value->>'paused')::boolean,false) as paused from app_settings where key='service_status'`;
    if(pauseRows[0]?.paused)throw new Error("SERVICE_PAUSED_BY_ADMIN");
    if(!Number.isInteger(input.reservedMicroUsd)||input.reservedMicroUsd<=0)throw new Error("INVALID_COST_RESERVATION");
    const kind=input.kind||"text";
    await tx`insert into usage_ledger(request_id,user_id,model_alias,status,reserved_cost_micro_usd,usage_kind) values(${input.requestId},${input.userId},${input.modelAlias},'reserved',${input.reservedMicroUsd},${kind})`;
    const buckets:Array<{owner:string;scope:string;limit:number;start:string;error:string}>=[];
    const controls=await tx<Array<{cap:string|null}>>`select value->>'globalDailyCapUsd' as cap from app_settings where key='cost_controls'`;
    const globalCap=Number(controls[0]?.cap||getEnv().GLOBAL_DAILY_COST_CAP_USD);
    if(!Number.isFinite(globalCap)||globalCap<=0)throw new Error("GLOBAL_COST_CIRCUIT_OPEN");
    buckets.push({owner:"global",scope:"global-day",limit:Math.floor(globalCap*1_000_000),start:windowStart("day"),error:"GLOBAL_COST_CIRCUIT_OPEN"});

    for(const bucket of buckets){
      const starts=await tx.unsafe<Array<{start:string}>>(`select ${bucket.start} as start`);const start=starts[0].start;
      await tx`insert into usage_buckets(owner_key,scope,window_start,reserved_micro_usd,spent_micro_usd) values(${bucket.owner},${bucket.scope},${start},0,0) on conflict do nothing`;
      const updated=await tx<Array<{owner_key:string}>>`update usage_buckets set reserved_micro_usd=reserved_micro_usd+${input.reservedMicroUsd},updated_at=now() where owner_key=${bucket.owner} and scope=${bucket.scope} and window_start=${start} and reserved_micro_usd+spent_micro_usd+${input.reservedMicroUsd}<=${bucket.limit} returning owner_key`;
      if(!updated.length)throw new Error(bucket.error);
      await tx`insert into usage_reservation_buckets(request_id,owner_key,scope,window_start,reserved_micro_usd) values(${input.requestId},${bucket.owner},${bucket.scope},${start},${input.reservedMicroUsd})`;
    }
    return {plan};
  });
}

export async function settleTextCost(input:{requestId:string;inputTokens:number;outputTokens:number;actualMicroUsd:number;providerRequestId?:string|null;settleCredit?:boolean}){
  await db().begin(async(tx)=>{
    const ledger=await tx<Array<{status:string}>>`select status from usage_ledger where request_id=${input.requestId} for update`;
    if(ledger[0]?.status!=="reserved")return;
    const refs=await tx<Array<{owner_key:string;scope:string;window_start:string;reserved_micro_usd:number}>>`select owner_key,scope,window_start,reserved_micro_usd from usage_reservation_buckets where request_id=${input.requestId}`;
    const actual=Math.max(0,input.actualMicroUsd);
    for(const ref of refs)await tx`update usage_buckets set reserved_micro_usd=greatest(0,reserved_micro_usd-${ref.reserved_micro_usd}),spent_micro_usd=spent_micro_usd+${actual},updated_at=now() where owner_key=${ref.owner_key} and scope=${ref.scope} and window_start=${ref.window_start}`;
    await tx`update usage_ledger set status='settled',input_tokens=${input.inputTokens},output_tokens=${input.outputTokens},actual_cost_micro_usd=${actual},provider_request_id=${input.providerRequestId||null},settled_at=now() where request_id=${input.requestId}`;
    if(input.settleCredit!==false)await tx`update text_credit_ledger set status='settled',settled_at=now() where request_id=${input.requestId} and status='reserved'`;
    await tx`delete from usage_reservation_buckets where request_id=${input.requestId}`;
  });
}

export async function releaseTextCredits(requestId:string,reason:string){
  await db()`update text_credit_ledger set status='released',error_code=${reason.slice(0,80)},settled_at=now() where request_id=${requestId} and status='reserved'`;
}

export async function releaseTextReservation(requestId:string,reason:string){
  await db().begin(async(tx)=>{
    const ledger=await tx<Array<{status:string}>>`select status from usage_ledger where request_id=${requestId} for update`;
    if(ledger[0]?.status==="reserved"){
      const refs=await tx<Array<{owner_key:string;scope:string;window_start:string;reserved_micro_usd:number}>>`select owner_key,scope,window_start,reserved_micro_usd from usage_reservation_buckets where request_id=${requestId}`;
      for(const ref of refs)await tx`update usage_buckets set reserved_micro_usd=greatest(0,reserved_micro_usd-${ref.reserved_micro_usd}),updated_at=now() where owner_key=${ref.owner_key} and scope=${ref.scope} and window_start=${ref.window_start}`;
      await tx`update usage_ledger set status='released',error_code=${reason.slice(0,80)},settled_at=now() where request_id=${requestId}`;
      await tx`delete from usage_reservation_buckets where request_id=${requestId}`;
    }
    await tx`update text_credit_ledger set status='released',error_code=${reason.slice(0,80)},settled_at=now() where request_id=${requestId} and status='reserved'`;
  });
}

function imageStart(interval:"day"|"month"|"3 hours"|"week"){
  if(interval==="3 hours")return "(date_trunc('hour',now() at time zone 'Asia/Tehran') - ((extract(hour from now() at time zone 'Asia/Tehran')::int % 3) * interval '1 hour')) at time zone 'Asia/Tehran'";
  return `date_trunc('${interval}',now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran'`;
}

export async function reserveImageCredits(input:{userId:string;requestId:string;modelAlias:string;credits:number}){
  return db().begin(async(tx)=>{
    await tx`select pg_advisory_xact_lock(hashtext(${input.userId}))`;
    const plans=await tx<Array<{code:string;credits:number;interval:string}>>`
      select coalesce(p.code,free_plan.code) as code,coalesce(p.image_credit_limit,free_plan.image_credit_limit) as credits,
             coalesce(p.image_reset_interval,free_plan.image_reset_interval) as interval
      from users u cross join plans free_plan
      left join subscriptions s on s.user_id=u.id and s.status='active' and s.ends_at>now()
      left join plans p on p.id=s.plan_id where u.id=${input.userId} and free_plan.code='free'
      order by p.monthly_price_toman desc nulls last,s.ends_at desc nulls last limit 1`;
    const allowance=plans[0];if(!allowance||!["day","month","3 hours","week"].includes(allowance.interval))throw new Error("IMAGE_PLAN_DISABLED");
    const interval=allowance.interval as "day"|"month"|"3 hours"|"week";
    const rows=await tx.unsafe<{used:string}[]>(`select coalesce(sum(credits),0)::text as used from image_credit_ledger where user_id=$1 and status in ('reserved','settled') and created_at>=${imageStart(interval)}`,[input.userId]);
    if(Number(rows[0]?.used||0)+input.credits>Number(allowance.credits))throw new Error("IMAGE_CREDITS_EXCEEDED");
    await tx`insert into image_credit_ledger(request_id,user_id,model_alias,credits,status) values(${input.requestId},${input.userId},${input.modelAlias},${input.credits},'reserved')`;
    return {plan:allowance.code,remaining:Number(allowance.credits)-Number(rows[0]?.used||0)-input.credits};
  });
}

export async function releaseImageCredits(requestId:string,reason:string){await db()`update image_credit_ledger set status='released',error_code=${reason.slice(0,80)},settled_at=now() where request_id=${requestId} and status='reserved'`;}

export async function completeImageGeneration(input:{requestId:string;providerRequestId?:string|null;actualMicroUsd:number;fileId:string;revisedPrompt?:string|null}){
  await db().begin(async(tx)=>{
    const jobs=await tx<Array<{status:string;conversation_id:string|null;user_id:string;model_alias:string}>>`select status,conversation_id,user_id,model_alias from image_jobs where request_id=${input.requestId} for update`;
    const job=jobs[0];if(!job||!["queued","processing"].includes(job.status))throw new Error("IMAGE_JOB_NOT_COMPLETABLE");
    const ledger=await tx<Array<{status:string}>>`select status from usage_ledger where request_id=${input.requestId} for update`;
    if(ledger[0]?.status!=="reserved")throw new Error("USAGE_LEDGER_NOT_RESERVED");
    const refs=await tx<Array<{owner_key:string;scope:string;window_start:string;reserved_micro_usd:number}>>`select owner_key,scope,window_start,reserved_micro_usd from usage_reservation_buckets where request_id=${input.requestId}`;
    const actual=Math.max(0,input.actualMicroUsd);
    for(const ref of refs)await tx`update usage_buckets set reserved_micro_usd=greatest(0,reserved_micro_usd-${ref.reserved_micro_usd}),spent_micro_usd=spent_micro_usd+${actual},updated_at=now() where owner_key=${ref.owner_key} and scope=${ref.scope} and window_start=${ref.window_start}`;
    await tx`update usage_ledger set status='settled',input_tokens=0,output_tokens=0,actual_cost_micro_usd=${actual},provider_request_id=${input.providerRequestId||null},settled_at=now() where request_id=${input.requestId}`;
    await tx`delete from usage_reservation_buckets where request_id=${input.requestId}`;
    const credits=await tx<Array<{request_id:string}>>`update image_credit_ledger set status='settled',provider_request_id=${input.providerRequestId||null},settled_at=now() where request_id=${input.requestId} and status='reserved' returning request_id`;
    if(!credits.length)throw new Error("IMAGE_CREDIT_NOT_RESERVED");
    await tx`update image_jobs set status='completed',file_id=${input.fileId},provider_request_id=${input.providerRequestId||null},revised_prompt=${input.revisedPrompt||null},completed_at=now() where request_id=${input.requestId}`;
    if(job.conversation_id){
      const content=input.revisedPrompt||"تصویر آماده شد.";
      const [message]=await tx<Array<{id:string}>>`insert into messages(conversation_id,user_id,role,content,model_alias) values(${job.conversation_id},${job.user_id},'assistant',${content},${job.model_alias}) returning id`;
      await tx`insert into message_files(message_id,file_id) values(${message.id},${input.fileId}) on conflict do nothing`;
    }
  });
}

export async function paidPlanReadiness(){
  const [plans,models,settings]=await Promise.all([
    db()<Array<{code:string;monthly_price_toman:number|string;total_weekly_micro_usd:number|string|null}>>`
      select p.code,p.monthly_price_toman,policy.total_weekly_micro_usd from plans p
      left join plan_usage_policies policy on policy.plan_code=p.code where p.code in ('starter','plus','pro','ultra')`,
    db()<Array<{enabled:string;priced:string;texts:string;images:string}>>`
      select count(*) filter(where enabled)::text as enabled,
             count(*) filter(where enabled and ((type='text' and input_usd_per_million>0 and output_usd_per_million>0) or (type='image' and image_usd>0)))::text as priced,
             count(*) filter(where enabled and type='text')::text as texts,count(*) filter(where enabled and type='image')::text as images from runtime_models`,
    db()<Array<{value:Record<string,unknown>}>>`select value from app_settings where key='cost_controls'`,
  ]);
  const env=getEnv();const controls=settings[0]?.value||{};const rate=Number(controls.usdTomanRate||env.USD_TOMAN_RATE);const share=Number(controls.maxApiCostShare||env.MAX_API_COST_SHARE);
  const catalog=models[0];const catalogReady=Number(catalog?.enabled||0)===Number(catalog?.priced||0)&&Number(catalog?.texts||0)>=5&&Number(catalog?.images||0)>=2;
  const result:Record<string,boolean>={starter:false,plus:false,pro:false,ultra:false};
  if(!catalogReady||!Number.isFinite(rate)||rate<=0||!Number.isFinite(share)||share<=0)return result;
  for(const plan of plans){const weekly=Number(plan.total_weekly_micro_usd||0);const allowedMonthlyMicroUsd=Number(plan.monthly_price_toman)/rate*share*1_000_000;result[plan.code]=weekly>0&&weekly*4.35<=allowedMonthlyMicroUsd;}
  return result;
}

export async function paidPlansReady(planCode?:string){const readiness=await paidPlanReadiness();return planCode?Boolean(readiness[planCode]):Object.values(readiness).every(Boolean);}

export async function usageSnapshot(userId:string,plan:string){
  const rows=await db()<Array<{code:string;text_credit_3h:number;text_credit_weekly:number;image_credit_limit:number}>>`
    select code,text_credit_3h,text_credit_weekly,image_credit_limit from plans where code=${plan}
    union all select code,text_credit_3h,text_credit_weekly,image_credit_limit from plans where code='free' and not exists(select 1 from plans where code=${plan}) limit 1`;
  const policy=rows[0];if(!policy)throw new Error("PLAN_USAGE_DISABLED");
  const [starts,textRows,imageRows]=await Promise.all([
    db().unsafe<Array<{start_3h:string;reset_3h:string;start_week:string;reset_week:string}>>(`select ${threeHourStart()} as start_3h,${threeHourStart()}+interval '3 hours' as reset_3h,${windowStart("week")} as start_week,${windowStart("week")}+interval '1 week' as reset_week`),
    db().unsafe<Array<{used_3h:string;used_week:string}>>(`select coalesce(sum(credits) filter(where created_at>=${threeHourStart()}),0)::text as used_3h,coalesce(sum(credits) filter(where created_at>=${windowStart("week")}),0)::text as used_week from text_credit_ledger where user_id=$1 and status in ('reserved','settled')`,[userId]),
    db().unsafe<Array<{used:string}>>(`select coalesce(sum(credits),0)::text as used from image_credit_ledger where user_id=$1 and status in ('reserved','settled') and created_at>=${imageStart("week")}`,[userId]),
  ]);
  const used3h=Number(textRows[0]?.used_3h||0);const usedWeek=Number(textRows[0]?.used_week||0);const imageUsed=Number(imageRows[0]?.used||0);
  const percent=(used:number,limit:number)=>limit>0?Math.min(100,Math.round(used/limit*100)):100;
  return{plan,text:[
    {window:"3 hours",used:used3h,limit:Number(policy.text_credit_3h),usedPercent:percent(used3h,Number(policy.text_credit_3h)),resetAt:new Date(starts[0].reset_3h).toISOString()},
    {window:"week",used:usedWeek,limit:Number(policy.text_credit_weekly),usedPercent:percent(usedWeek,Number(policy.text_credit_weekly)),resetAt:new Date(starts[0].reset_week).toISOString()},
  ],image:{used:imageUsed,limit:Number(policy.image_credit_limit),usedPercent:percent(imageUsed,Number(policy.image_credit_limit)),window:"week",resetAt:new Date(starts[0].reset_week).toISOString()}};
}
