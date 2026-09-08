"use client";

// صفحه خطای سراسری — وقتی خود Next هم از پا دربیاید، این صفحه نشان داده می‌شود.
// نسخه صریح این فایل، پیش‌رندر داخلی /_global-error را هم پایدار می‌کند.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // جای لاگ‌کردن در سمت کاربر لازم نیست؛ رخداد سمت سرور ثبت می‌شود.
    console.error(error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#07080d",
          color: "#e8e9f2",
          fontFamily: "Vazirmatn, system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 .5rem" }}>خطای غیرمنتظره‌ای رخ داد</h1>
          <p style={{ color: "#9a9cb0", fontSize: ".875rem", lineHeight: 1.9, margin: "0 0 1.25rem" }}>
            مشکلی در نمایش Portal AI پیش آمد. می‌توانی دوباره تلاش کنی یا صفحه را تازه‌سازی کنی.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "2.75rem",
              padding: "0 1.25rem",
              border: "0",
              borderRadius: ".8125rem",
              background: "#7182f4",
              color: "#fff",
              fontSize: ".875rem",
              fontWeight: 650,
              cursor: "pointer",
            }}
          >
            تلاش دوباره
          </button>
        </div>
      </body>
    </html>
  );
}
