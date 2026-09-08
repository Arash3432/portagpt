-- Portal AI 1.3: Liara AI provider, company-grouped catalog and explicit
-- three-hour/weekly text credits plus weekly image credits.

alter table plans add column if not exists text_credit_3h integer not null default 10 check (text_credit_3h >= 0);
alter table plans add column if not exists text_credit_weekly integer not null default 50 check (text_credit_weekly >= 0);

update plans set
  text_credit_3h = case code when 'free' then 10 when 'starter' then 25 when 'plus' then 85 when 'pro' then 300 when 'ultra' then 600 else text_credit_3h end,
  text_credit_weekly = case code when 'free' then 50 when 'starter' then 250 when 'plus' then 1000 when 'pro' then 5000 when 'ultra' then 20000 else text_credit_weekly end,
  image_credit_limit = case code when 'free' then 1 when 'starter' then 15 when 'plus' then 100 when 'pro' then 450 when 'ultra' then 950 else image_credit_limit end,
  image_reset_interval = 'week',
  updated_at = now()
where code in ('free','starter','plus','pro','ultra');

create table if not exists text_credit_ledger (
  request_id uuid primary key,
  user_id uuid not null references users(id),
  model_alias varchar(80) not null,
  credits smallint not null check (credits between 1 and 100),
  status ledger_status not null,
  error_code varchar(80),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists text_credit_user_window_idx on text_credit_ledger(user_id,created_at desc,status);

alter table runtime_models add column if not exists message_credits smallint not null default 1 check (message_credits between 1 and 100);
alter table runtime_models add column if not exists display_order smallint not null default 100 check (display_order between 0 and 1000);

delete from runtime_models;
insert into runtime_models(
  alias,display_name,description,provider_model,type,enabled,input_usd_per_million,
  output_usd_per_million,image_usd,image_credits,image_size,image_quality,max_output_tokens,
  minimum_plan_rank,cost_multiplier,is_default,fallback_alias,pricing_source_url,pricing_checked_at,
  message_credits,display_order
) values
 ('sirius','Sirius','انتخاب پیش‌فرض سریع و اقتصادی Portal AI','google/gemini-3.5-flash-lite','text',true,0.10,0.40,0,1,null,null,4096,0,1.50,true,'glm-5-1','https://liara.ir/products/ai','2026-08-20',1,0),

 ('glm-5-3','GLM 5.3','پرچم‌دار Z.ai برای تحلیل، کدنویسی و کارهای پیچیده','z-ai/glm-5.3','text',true,2.00,10.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',3,10),
 ('glm-5-2','GLM 5.2','مدل متعادل Z.ai برای کارهای دقیق و روزمره','z-ai/glm-5.2','text',true,1.00,5.00,0,1,null,null,8192,1,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',2,20),
 ('glm-5-1','GLM 5.1','مدل سریع و کم‌هزینه Z.ai','z-ai/glm-5.1','text',true,0.20,1.00,0,1,null,null,4096,0,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',1,30),

 ('kimi-k3','Kimi K3','مدل پیشرفته MoonshotAI برای استدلال و متن‌های بلند','moonshotai/kimi-k3','text',true,3.00,15.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',4,10),
 ('kimi-k2-7-code','Kimi K2.7 Code','مدل تخصصی MoonshotAI برای برنامه‌نویسی','moonshotai/kimi-k2.7-code','text',true,2.50,12.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',3,20),

 ('claude-opus-5','Claude Opus 5','مدل پرچم‌دار Anthropic برای استدلال و کدنویسی','anthropic/claude-opus-5','text',true,10.00,50.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',6,10),
 ('claude-opus-5-fast','Claude Opus 5 Fast','نسخه سریع Opus برای پاسخ‌های حرفه‌ای کم‌تأخیر','anthropic/claude-opus-5-fast','text',true,12.00,60.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',7,20),
 ('claude-fable-5','Claude Fable 5','مدل خلاق Anthropic برای نوشتن و عامل‌های طولانی','anthropic/claude-fable-5','text',true,6.00,30.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',5,30),

 ('gpt-5-6-sol-pro','GPT-5.6 Sol Pro','بالاترین مدل OpenAI برای مسائل بسیار دشوار','openai/gpt-5.6-sol-pro','text',true,10.00,60.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',8,10),
 ('gpt-5-6-terra-pro','GPT-5.6 Terra Pro','مدل حرفه‌ای متعادل OpenAI','openai/gpt-5.6-terra-pro','text',true,6.00,36.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',6,20),
 ('gpt-5-6-luna-pro','GPT-5.6 Luna Pro','نسخه حرفه‌ای سریع OpenAI','openai/gpt-5.6-luna-pro','text',true,3.00,18.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',4,30),
 ('gpt-5-6-sol','GPT-5.6 Sol','مدل قدرتمند OpenAI برای تحلیل عمیق','openai/gpt-5.6-sol','text',true,5.00,30.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',5,40),
 ('gpt-5-6-terra','GPT-5.6 Terra','تعادل سرعت و قدرت برای کارهای عمومی','openai/gpt-5.6-terra','text',true,2.00,12.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',3,50),
 ('gpt-5-6-luna','GPT-5.6 Luna','مدل سریع OpenAI برای استفاده روزمره','openai/gpt-5.6-luna','text',true,0.50,3.00,0,1,null,null,4096,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',2,60),
 ('gpt-image-2','GPT Image 2','مدل ساخت تصویر OpenAI','openai/gpt-image-2','image',true,0,0,0.120,1,'1024x1024','medium',1024,0,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',1,70),

 ('gemini-3-7-flash','Gemini 3.7 Flash','پیشرفته‌ترین Flash گوگل برای کارهای چندمرحله‌ای','google/gemini-3.7-flash','text',true,1.00,5.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',3,10),
 ('gemini-3-6-flash','Gemini 3.6 Flash','مدل سریع چندرسانه‌ای گوگل','google/gemini-3.6-flash','text',true,0.75,3.75,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',2,20),
 ('gemini-3-5-flash','Gemini 3.5 Flash','مدل هوشمند و اقتصادی گوگل','google/gemini-3.5-flash','text',true,0.50,2.50,0,1,null,null,8192,1,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',1,30),
 ('gemini-3-5-flash-lite','Gemini 3.5 Flash Lite','مدل بسیار سریع و کم‌هزینه گوگل','google/gemini-3.5-flash-lite','text',true,0.10,0.40,0,1,null,null,4096,1,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',1,40),
 ('gemini-3-pro-image','Gemini 3 Pro Image','مدل ساخت تصویر گوگل','google/gemini-3-pro-image-preview','image',true,0,0,0.150,2,'1024x1024',null,1024,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',1,50),

 ('grok-4-6','Grok 4.6','مدل پرچم‌دار SpaceXAI برای استدلال و اطلاعات روز','x-ai/grok-4.6','text',true,8.00,40.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',6,10),
 ('grok-4-5','Grok 4.5','مدل قدرتمند SpaceXAI برای تحلیل عمومی','x-ai/grok-4.5','text',true,5.00,25.00,0,1,null,null,8192,2,1.50,false,null,'https://liara.ir/products/ai','2026-08-20',4,20);

-- Every model starts at one visible credit. The administrator can raise the
-- weight later after comparing real Liara AI invoices with product margins.
update runtime_models set message_credits=1,image_credits=1;

insert into app_settings(key,value)
values ('provider_config','{"baseUrl":"https://ai.liara.ir/api/6a86dc6b10aa277170f84256/v1","chatPath":"/chat/completions","imagePath":"/images/generations","enabled":true,"lastTestStatus":"changed","lastTestAt":null,"lastModelCount":null}'::jsonb)
on conflict(key) do update set value=app_settings.value || excluded.value,updated_at=now();

create or replace function portal_release_stale_reservations() returns integer language plpgsql as $$
declare released_count integer;
begin
  with stale as (
    select request_id from usage_ledger where status='reserved' and created_at<now()-interval '10 minutes' for update skip locked
  ), adjustments as (
    update usage_buckets b set reserved_micro_usd=greatest(0,b.reserved_micro_usd-r.total),updated_at=now()
    from (
      select rb.owner_key,rb.scope,rb.window_start,sum(rb.reserved_micro_usd)::bigint as total
      from usage_reservation_buckets rb join stale s on s.request_id=rb.request_id
      group by rb.owner_key,rb.scope,rb.window_start
    ) r where b.owner_key=r.owner_key and b.scope=r.scope and b.window_start=r.window_start returning 1
  ), released as (
    update usage_ledger u set status='released',error_code='STALE_RESERVATION',settled_at=now()
    where u.request_id in (select request_id from stale) returning u.request_id
  ), released_text as (
    update text_credit_ledger t set status='released',error_code='STALE_RESERVATION',settled_at=now()
    where t.request_id in (select request_id from released) and t.status='reserved' returning t.request_id
  ), released_images as (
    update image_credit_ledger i set status='released',error_code='STALE_RESERVATION',settled_at=now()
    where i.request_id in (select request_id from released) and i.status='reserved' returning i.request_id
  ), failed_jobs as (
    update image_jobs j set status='failed',error_code='STALE_RESERVATION',completed_at=now()
    where j.request_id in (select request_id from released) and j.status in ('queued','processing') returning j.request_id
  )
  delete from usage_reservation_buckets where request_id in (select request_id from released);
  get diagnostics released_count = row_count;
  return released_count;
end $$;
