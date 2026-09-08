# گزارش اعتبارسنجی امنیت و پایداری — Portal AI 1.4

تاریخ گزارش: ۲۵ اوت ۲۰۲۶

## نتیجه

کنترل‌های مهم احراز هویت، نشست، پنل مدیریت، SSRF، cache خصوصی و مسیرهای خروجی سرویس بازبینی و تقویت شدند. آزمون‌های قابل اجرای بدون دسترسی به محیط واقعی Liara همگی پاس شده‌اند. این گزارش به‌معنای تضمین «امنیت صددرصد» یا جایگزین تست نفوذ مستقل روی staging نیست.

## سناریوهای حمله و رگرسیون پوشش‌داده‌شده

| دسته | کنترل/آزمون |
|---|---|
| ارتقای غیرمجاز مدیر | شمارهٔ مدیر در ثبت‌نام و OTP با `ADMIN_PASSWORD_REQUIRED` رد می‌شود؛ bootstrap فقط از مسیر ورود، شمارهٔ پیکربندی‌شده و راز محیطی انجام می‌شود. |
| brute force | rate limit جدا برای IP، حساب، مدیر و OTP؛ نشست مدیر محدود به ۱۲ ساعت و تک‌دستگاه است. |
| hijack نشست مدیر | اتصال نشست مدیر به IP و User-Agent، revoke در عدم تطابق و ثبت رخداد بحرانی. |
| CSRF و کوکی malformed | Origin check، SameSite/HttpOnly/Secure، CSRF hash و مقایسهٔ timing-safe؛ cookie با بخش اضافه رد می‌شود. |
| SSRF و open redirect | IP literal، مقصد داخلی و host خارج از allowlist رد می‌شوند؛ fetch خارجی chat/image/SMS با `redirect: "error"` اجرا می‌شود. |
| افشای دادهٔ خصوصی از cache | Asset خصوصی `no-store` است؛ Service Worker پاسخ خصوصی، `Set-Cookie`، `Vary: Cookie/Authorization` و URL query را cache نمی‌کند. |
| race condition پنل | version guard برای جست‌وجوی کاربر و Drawer؛ حالت unavailable جدا از denied. |
| بازشدن ناخواستهٔ فرم ورود | وضعیت نشست مشترک، انتظار تا اتمام check و بستن Dialog هنگام تأیید ورود در همان/تب دیگر. |

## فرمان‌ها و نتایج

| فرمان | نتیجه |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | پاس؛ نصب تمیز از lockfile |
| `npm test` | پاس؛ ۲۴ آزمون امنیتی/رگرسیون، TypeScript و ESLint |
| `npm run audit:production` | پاس؛ ۰ آسیب‌پذیری production |
| `npm audit --audit-level=low` | پاس؛ ۰ آسیب‌پذیری در کل درخت dependency |
| build production با Node 22.13 | پاس؛ Turbopack compile و TypeScript کامل شد، `.next/BUILD_ID` تولید شد و `npm run validate:artifact` پاس شد. |
| smoke test production | پاس؛ `/`، `/plans`، `/app`، `/account` و `/settings` هرکدام پاسخ ۲۰۰ دادند. |

## محدودیت‌های این اعتبارسنجی

- تست نفوذ اینترنتی، DDoS یا حمله به سامانهٔ واقعی Liara انجام نشده است؛ چنین کاری بدون staging و مجوز عملیاتی نباید انجام شود.
- محیط sandbox این گزارش syscall حافظهٔ `uv_resident_set_memory` را در Node مسدود می‌کند؛ build با Node 22 و shim موقتِ صرفاً مربوط به حساب‌گیری حافظه اجرا شد. Dockerfile نهایی هیچ shimی ندارد و همچنان باید در pipeline واقعی Liara نیز build شود.
- تست end-to-end نیازمند PostgreSQL، Redis، Object Storage و دامنهٔ staging جداگانه است.

## اقدام لازم پیش از انتشار عمومی

چک‌لیست `LIARA-PREDEPLOY-CHECKLIST.md` را کامل کنید، به‌خصوص اجرای build با Node 22، تست `/api/health`، اولین ورود مدیر، allowlist دقیق hostهای Provider و بررسی backup/alert در Liara.
