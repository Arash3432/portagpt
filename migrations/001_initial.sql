create extension if not exists pgcrypto;

do $$ begin
  create type user_status as enum ('active','suspended','deleted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type user_role as enum ('user','support','admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type subscription_status as enum ('pending','active','expired','cancelled','refunded');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ledger_status as enum ('reserved','settled','released');
exception when duplicate_object then null; end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  display_name text,
  locale varchar(5) not null default 'fa',
  status user_status not null default 'active',
  role user_role not null default 'user',
  suspended_reason text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code varchar(32) not null unique,
  title text not null,
  monthly_price_toman bigint not null check (monthly_price_toman >= 0),
  image_credit_limit integer not null check (image_credit_limit >= 0),
  image_reset_interval varchar(20) not null,
  file_limit_per_message smallint not null check (file_limit_per_message between 0 and 15),
  enabled boolean not null default true,
  payment_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into plans (code,title,monthly_price_toman,image_credit_limit,image_reset_interval,file_limit_per_message,payment_enabled)
values
 ('free','Free',0,1,'day',3,false),
 ('starter','Starter',128800,25,'month',10,false),
 ('plus','Plus',495900,45,'month',10,false),
 ('pro','Pro',1295900,100,'3 hours',10,false),
 ('ultra','Ultra',2895000,250,'day',15,false)
on conflict (code) do nothing;

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status subscription_status not null,
  source varchar(24) not null default 'site',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists subscriptions_user_active_idx on subscriptions(user_id,status,ends_at desc);
create unique index if not exists subscriptions_external_reference_idx on subscriptions(external_reference) where external_reference is not null;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null unique,
  csrf_hash char(64) not null,
  user_agent text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id,expires_at desc);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title varchar(160) not null,
  model_alias varchar(80) not null,
  pinned boolean not null default false,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx on conversations(user_id,updated_at desc) where deleted_at is null;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role varchar(16) not null check (role in ('user','assistant','system')),
  content text not null,
  model_alias varchar(80),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages(conversation_id,created_at);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  storage_key text not null unique,
  original_name varchar(200) not null,
  mime_type varchar(150) not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 52428800),
  status varchar(20) not null check (status in ('pending','ready','quarantined','deleted')),
  kind varchar(20) not null check (kind in ('upload','generated','export')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists files_user_idx on files(user_id,created_at desc) where deleted_at is null;

create table if not exists message_files (
  message_id uuid not null references messages(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  primary key (message_id,file_id)
);

create table if not exists usage_ledger (
  request_id uuid primary key,
  user_id uuid not null references users(id),
  model_alias varchar(80) not null,
  status ledger_status not null,
  reserved_cost_micro_usd bigint not null check (reserved_cost_micro_usd >= 0),
  actual_cost_micro_usd bigint not null default 0 check (actual_cost_micro_usd >= 0),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  provider_request_id text,
  error_code varchar(80),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists usage_ledger_user_window_idx on usage_ledger(user_id,created_at desc,status);
create index if not exists usage_ledger_global_window_idx on usage_ledger(created_at desc,status);

create table if not exists usage_buckets (
  owner_key text not null,
  scope varchar(32) not null,
  window_start timestamptz not null,
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_key,scope,window_start)
);
create index if not exists usage_buckets_cleanup_idx on usage_buckets(window_start);

create table if not exists usage_reservation_buckets (
  request_id uuid not null references usage_ledger(request_id) on delete cascade,
  owner_key text not null,
  scope varchar(32) not null,
  window_start timestamptz not null,
  reserved_micro_usd bigint not null check (reserved_micro_usd >= 0),
  primary key (request_id,owner_key,scope,window_start)
);

create table if not exists image_credit_ledger (
  request_id uuid primary key,
  user_id uuid not null references users(id),
  model_alias varchar(80) not null,
  credits integer not null check (credits > 0),
  status ledger_status not null,
  provider_request_id text,
  error_code varchar(80),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists image_credit_user_window_idx on image_credit_ledger(user_id,created_at desc,status);

create table if not exists image_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references image_credit_ledger(request_id),
  user_id uuid not null references users(id),
  conversation_id uuid references conversations(id) on delete set null,
  model_alias varchar(80) not null,
  prompt text not null,
  file_id uuid references files(id),
  status varchar(20) not null,
  credits integer not null,
  cost_micro_usd bigint not null,
  provider_request_id text,
  revised_prompt text,
  error_code varchar(80),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table image_jobs add column if not exists provider_request_id text;
alter table image_jobs add column if not exists conversation_id uuid references conversations(id) on delete set null;
alter table image_jobs add column if not exists revised_prompt text;
alter table image_jobs add column if not exists error_code varchar(80);
alter table image_jobs add column if not exists completed_at timestamptz;

-- آزادسازی رزروهایی که پس از crash فرایند نیمه‌تمام مانده‌اند.
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

create table if not exists payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  plan_id uuid not null references plans(id),
  amount_toman bigint not null check (amount_toman > 0),
  status varchar(20) not null check (status in ('created','pending','paid','failed','refunded')),
  gateway varchar(40) not null,
  authority text unique,
  gateway_reference text unique,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_user_idx on payment_transactions(user_id,created_at desc);

create table if not exists security_events (
  id bigserial primary key,
  user_id uuid references users(id),
  event_type varchar(80) not null,
  severity varchar(12) not null check (severity in ('info','warning','critical')),
  ip_hash char(64),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_events_recent_idx on security_events(created_at desc,severity);

create table if not exists admin_audit_logs (
  id bigserial primary key,
  admin_user_id uuid not null references users(id),
  action varchar(100) not null,
  target_type varchar(40),
  target_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_recent_idx on admin_audit_logs(created_at desc);

create table if not exists app_settings (
  key varchar(100) primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  status varchar(20) not null default 'pending',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create or replace function touch_conversation() returns trigger language plpgsql as $$
begin update conversations set updated_at=now() where id=new.conversation_id; return new; end $$;
drop trigger if exists messages_touch_conversation on messages;
create trigger messages_touch_conversation after insert on messages for each row execute function touch_conversation();
