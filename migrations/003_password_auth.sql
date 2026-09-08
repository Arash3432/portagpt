-- Password-first authentication. SMS remains an optional verification and
-- recovery channel; public registration and login do not depend on it.

alter table users add column if not exists email text;
alter table users add column if not exists phone_verified_at timestamptz;
alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists terms_accepted_at timestamptz;

create unique index if not exists users_email_unique_idx
  on users (lower(email))
  where email is not null and deleted_at is null;

create table if not exists user_password_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash varchar(255) not null check (password_hash like 'scrypt$1$%'),
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists users_phone_verified_idx
  on users (phone_verified_at)
  where phone_verified_at is not null;
