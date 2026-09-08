-- Portal AI production control center: live model catalog, protected provider
-- secrets, editable plan policies, step-up administration, and richer audit data.

alter table sessions add column if not exists admin_verified_at timestamptz;
alter table sessions add column if not exists ip_hash char(64);
alter table sessions add column if not exists last_seen_at timestamptz not null default now();
create index if not exists sessions_admin_fresh_idx on sessions(user_id,admin_verified_at desc) where revoked_at is null;
create index if not exists messages_user_created_idx on messages(user_id,created_at desc);
create index if not exists subscriptions_current_user_idx on subscriptions(user_id,ends_at desc) where status='active';

alter table users add column if not exists risk_score smallint not null default 0 check (risk_score between 0 and 100);
alter table users add column if not exists admin_tags text[] not null default '{}'::text[];

alter table usage_ledger add column if not exists usage_kind varchar(12) not null default 'text';
do $$ begin
  alter table usage_ledger add constraint usage_ledger_kind_check check (usage_kind in ('text','image'));
exception when duplicate_object then null; end $$;

alter table security_events add column if not exists resolved_at timestamptz;
alter table security_events add column if not exists resolved_by uuid references users(id);
alter table security_events add column if not exists resolution text;
create index if not exists security_events_open_idx on security_events(severity,created_at desc) where resolved_at is null;

alter table admin_audit_logs add column if not exists ip_hash char(64);
alter table admin_audit_logs add column if not exists request_id uuid;

create or replace function portal_reject_audit_mutation() returns trigger language plpgsql as $$
begin raise exception 'admin audit logs are append-only'; end $$;
drop trigger if exists admin_audit_logs_append_only on admin_audit_logs;
create trigger admin_audit_logs_append_only before update or delete on admin_audit_logs
for each row execute function portal_reject_audit_mutation();

create table if not exists user_admin_notes (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  admin_user_id uuid not null references users(id),
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists user_admin_notes_user_idx on user_admin_notes(user_id,created_at desc);

create table if not exists provider_secrets (
  name varchar(80) primary key,
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  key_last_four varchar(4),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table if not exists runtime_models (
  alias varchar(80) primary key check (alias ~ '^[a-z0-9-]+$'),
  display_name varchar(100) not null,
  description varchar(220) not null default '',
  provider_model varchar(160) not null,
  type varchar(12) not null check (type in ('text','image')),
  enabled boolean not null default true,
  input_usd_per_million numeric(18,6) not null default 0 check (input_usd_per_million >= 0),
  output_usd_per_million numeric(18,6) not null default 0 check (output_usd_per_million >= 0),
  image_usd numeric(18,6) not null default 0 check (image_usd >= 0),
  image_credits smallint not null default 1 check (image_credits between 1 and 100),
  image_size varchar(24),
  image_quality varchar(16),
  max_output_tokens integer not null default 4096 check (max_output_tokens between 128 and 131072),
  minimum_plan_rank smallint not null default 0 check (minimum_plan_rank between 0 and 4),
  cost_multiplier numeric(6,3) not null default 1.350 check (cost_multiplier between 1 and 3),
  is_default boolean not null default false,
  fallback_alias varchar(80),
  pricing_source_url text,
  pricing_checked_at timestamptz,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
create index if not exists runtime_models_available_idx on runtime_models(type,enabled,minimum_plan_rank);

insert into runtime_models(alias,display_name,description,provider_model,type,enabled,input_usd_per_million,output_usd_per_million,image_usd,image_credits,image_size,image_quality,max_output_tokens,minimum_plan_rank,cost_multiplier,is_default,fallback_alias,pricing_source_url,pricing_checked_at)
values
 ('sirius','Sirius','پیش‌فرض سریع و اقتصادی Portal AI','gpt-5.6-luna','text',true,0.20,1.20,0,1,null,null,4096,0,1.35,true,'gemini-3-6-flash','https://developers.openai.com/api/docs/pricing','2026-08-14'),
 ('gpt-5-6-luna','GPT-5.6 Luna','سریع و کم‌هزینه برای کارهای روزمره','gpt-5.6-luna','text',true,0.20,1.20,0,1,null,null,4096,1,1.35,false,null,'https://developers.openai.com/api/docs/pricing','2026-08-14'),
 ('gemini-3-6-flash','Gemini 3.6 Flash','سریع، چندرسانه‌ای و اقتصادی','gemini-3.6-flash','text',true,0.75,3.75,0,1,null,null,8192,0,1.35,false,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-08-14'),
 ('gemini-3-7-flash','Gemini 3.7 Flash','مدل Flash جدید برای جریان‌های چندمرحله‌ای','gemini-3.7-flash','text',true,0.75,3.75,0,1,null,null,8192,2,1.35,false,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-08-14'),
 ('gemini-3-5-flash','Gemini 3.5 Flash','پاسخ سریع و هوشمند برای کارهای عمومی','gemini-3.5-flash','text',true,1.50,9.00,0,1,null,null,8192,2,1.35,false,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-08-14'),
 ('gpt-5-6-terra','GPT-5.6 Terra','تعادل قدرت، سرعت و هزینه','gpt-5.6-terra','text',true,2.00,12.00,0,1,null,null,8192,2,1.35,false,null,'https://developers.openai.com/api/docs/pricing','2026-08-14'),
 ('claude-opus-5','Claude Opus 5','استدلال و کدنویسی حرفه‌ای','claude-opus-5','text',true,5.00,25.00,0,1,null,null,8192,3,1.35,false,null,'https://docs.anthropic.com/en/docs/about-claude/pricing','2026-08-14'),
 ('gpt-5-6-sol','GPT-5.6 Sol','مدل پرچم‌دار برای مسائل دشوار','gpt-5.6-sol','text',true,5.00,30.00,0,1,null,null,8192,3,1.35,false,null,'https://developers.openai.com/api/docs/pricing','2026-08-14'),
 ('claude-fable-5','Claude Fable 5','مدل بسیار قدرتمند برای عامل‌های طولانی','claude-fable-5','text',true,10.00,50.00,0,1,null,null,8192,4,1.35,false,null,'https://docs.anthropic.com/en/docs/about-claude/pricing','2026-08-14'),
 ('nano-banana-2','Nano Banana 2','تصویرسازی سریع Gemini','gemini-3.1-flash-image-preview','image',true,0,0,0.067,1,'1024x1024',null,1024,0,1.35,false,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-08-14'),
 ('gpt-image-2','GPT Image 2','تصویرسازی دقیق با کیفیت متوسط','gpt-image-2','image',true,0,0,0.053,1,'1024x1024','medium',1024,2,1.35,false,null,'https://developers.openai.com/api/docs/guides/image-generation','2026-08-14'),
 ('nano-banana-pro','Nano Banana Pro','تصویرسازی حرفه‌ای Gemini','gemini-3-pro-image-preview','image',true,0,0,0.134,2,'1024x1024',null,1024,3,1.35,false,null,'https://ai.google.dev/gemini-api/docs/pricing','2026-08-14')
on conflict(alias) do nothing;

create table if not exists plan_usage_policies (
  plan_code varchar(32) primary key references plans(code) on update cascade on delete cascade,
  total_hourly_micro_usd bigint check (total_hourly_micro_usd is null or total_hourly_micro_usd > 0),
  total_daily_micro_usd bigint check (total_daily_micro_usd is null or total_daily_micro_usd > 0),
  total_weekly_micro_usd bigint check (total_weekly_micro_usd is null or total_weekly_micro_usd > 0),
  text_hourly_micro_usd bigint check (text_hourly_micro_usd is null or text_hourly_micro_usd > 0),
  text_daily_micro_usd bigint check (text_daily_micro_usd is null or text_daily_micro_usd > 0),
  text_weekly_micro_usd bigint check (text_weekly_micro_usd is null or text_weekly_micro_usd > 0),
  image_hourly_micro_usd bigint check (image_hourly_micro_usd is null or image_hourly_micro_usd > 0),
  image_daily_micro_usd bigint check (image_daily_micro_usd is null or image_daily_micro_usd > 0),
  image_weekly_micro_usd bigint check (image_weekly_micro_usd is null or image_weekly_micro_usd > 0),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

insert into plan_usage_policies(plan_code,total_hourly_micro_usd,total_daily_micro_usd,total_weekly_micro_usd,text_hourly_micro_usd,text_daily_micro_usd,text_weekly_micro_usd,image_hourly_micro_usd,image_daily_micro_usd,image_weekly_micro_usd)
values
 ('free',null,100000,null,null,7000,null,null,100000,null),
 ('starter',100000,100000,100000,10000,20000,50000,100000,100000,100000),
 ('plus',100000,100000,170000,20000,50000,140000,100000,100000,170000),
 ('pro',200000,200000,445000,50000,150000,400000,200000,200000,450000),
 ('ultra',250000,450000,998000,100000,350000,900000,250000,450000,1000000)
on conflict(plan_code) do nothing;

insert into app_settings(key,value)
values
 ('provider_config','{"baseUrl":"https://api.gapgpt.app/v1","chatPath":"/chat/completions","imagePath":"/images/generations","enabled":true,"lastTestStatus":"never"}'::jsonb),
 ('cost_controls','{"globalDailyCapUsd":5,"usdTomanRate":200000,"maxApiCostShare":0.30,"warnAtPercent":80}'::jsonb),
 ('service_status','{"paused":false,"message":""}'::jsonb)
on conflict(key) do nothing;
