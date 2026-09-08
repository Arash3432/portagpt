import Image from "next/image";

export default function Loading() {
  return (
    <main className="portal-loading" role="status" aria-live="polite">
      <div className="portal-loading-mark">
        <Image unoptimized src="/portal-ai-logo.png" width={72} height={72} alt="" aria-hidden="true" priority />
      </div>
      <strong>Portal AI</strong>
      <span>در حال آماده‌سازی صفحه…</span>
      <i aria-hidden="true"><b /></i>
    </main>
  );
}
