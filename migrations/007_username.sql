-- 007_username.sql — نام کاربری تصادفی و قابل‌تغییر به‌جای شماره موبایل
-- همه کاربران یک شناسه کوتاه و خوانا می‌گیرند (مثال: User25255) که در رابط نمایش داده می‌شود.

alter table users add column if not exists username varchar(32);

-- یکتایی بدون توجه به بزرگی و کوچکی حروف؛ فقط برای نام‌های تنظیم‌شده.
create unique index if not exists users_username_unique_idx
  on users (lower(username))
  where username is not null;

-- کاربران موجود بدون نام کاربری، شناسه تصادفی می‌گیرند.
do $$
declare
  target record;
  candidate text;
  attempts int;
begin
  for target in select id from users where username is null loop
    attempts := 0;
    loop
      attempts := attempts + 1;
      candidate := 'User' || (10000 + floor(random() * 90000)::int)::text;
      begin
        update users set username = candidate, updated_at = now() where id = target.id and username is null;
        exit;
      exception when unique_violation then
        if attempts >= 12 then
          -- after 12 collisions fall back to a longer, practically collision-free suffix
          candidate := 'User' || (100000 + floor(random() * 900000)::int)::text;
          update users set username = candidate, updated_at = now() where id = target.id and username is null;
          exit;
        end if;
      end;
    end loop;
  end loop;
end $$;
