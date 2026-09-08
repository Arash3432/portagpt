"use client";

import { RefreshCw } from "lucide-react";

// مرز خطای مسیر — داخل چیدمان اصلی رندر می‌شود، پس html/body ندارد.
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="system-state">
      <section>
        <span>Portal AI</span>
        <h1>مشکلی در نمایش این صفحه پیش آمد.</h1>
        <p>بارگذاری صفحه کامل نشد. یک‌بار دوباره تلاش کنید.</p>
        <button type="button" className="public-primary" onClick={reset}>
          <RefreshCw size={18} /> تلاش دوباره
        </button>
      </section>
    </main>
  );
}
