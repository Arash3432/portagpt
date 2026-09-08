"use client";

import { ImagePlus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "./i18n";
import styles from "./generation-status.module.css";

const labels = {
  fa: {
    text: "در حال آماده‌کردن پاسخ",
    image: "در حال ساخت تصویر",
    textHint: "پاسخ به‌محض دریافت نمایش داده می‌شود.",
    imageHint: "پس از آماده‌شدن می‌توانید تصویر را دانلود کنید.",
    waiting: "درخواست هنوز در حال پردازش است.",
    elapsed: "زمان سپری‌شده",
  },
  en: {
    text: "Preparing your answer",
    image: "Creating your image",
    textHint: "The answer appears as it arrives.",
    imageHint: "Download your image when it is ready.",
    waiting: "Your request is still being processed.",
    elapsed: "Time elapsed",
  },
  ar: {
    text: "جارٍ إعداد الإجابة",
    image: "جارٍ إنشاء الصورة",
    textHint: "ستظهر الإجابة فور وصولها.",
    imageHint: "يمكنك تنزيل الصورة عندما تصبح جاهزة.",
    waiting: "لا يزال طلبك قيد المعالجة.",
    elapsed: "الوقت المنقضي",
  },
  zh: {
    text: "正在准备回答",
    image: "正在生成图片",
    textHint: "收到回答后会立即显示。",
    imageHint: "图片完成后即可下载。",
    waiting: "请求仍在处理中。",
    elapsed: "已用时间",
  },
};

export type GenerationStatusProps = {
  locale?: Locale;
  mode?: "text" | "image";
  /** Epoch milliseconds for the actual request start; omit to start on mount. */
  startedAt?: number;
};

export function GenerationStatus({ locale = "fa", mode = "text", startedAt }: GenerationStatusProps) {
  const [clock, setClock] = useState({ seconds: 0, visible: true });
  useEffect(() => {
    const started = typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    let frame = 0;
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1_000));
      const visible = !document.hidden;
      setClock((previous) => previous.seconds === seconds && previous.visible === visible
        ? previous : { seconds, visible });
    };
    const onVisibilityChange = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      update();
      if (!document.hidden) timer = setInterval(update, 1_000);
    };
    frame = window.requestAnimationFrame(onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [startedAt]);

  const copy = labels[locale];
  const number = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
  const elapsed = `${number.format(Math.floor(clock.seconds / 60))}:${number.format(clock.seconds % 60)}`;
  const Icon = mode === "image" ? ImagePlus : Sparkles;
  const hint = clock.seconds >= 35 ? copy.waiting : mode === "image" ? copy.imageHint : copy.textHint;

  return (
    <div className={styles.status} data-mode={mode} data-paused={!clock.visible || undefined} dir={locale === "fa" || locale === "ar" ? "rtl" : "ltr"}>
      <span className={styles.emblem} aria-hidden="true"><Icon size={21} strokeWidth={1.65} /></span>
      <div className={styles.copy}>
        <div className={styles.heading}>
          <span role="status" aria-live="polite" aria-atomic="true">{copy[mode]}</span>
          <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
        </div>
        <span className={styles.hint}>{hint}</span>
      </div>
      <span className={styles.elapsed} aria-label={`${copy.elapsed}: ${elapsed}`} dir="ltr">{elapsed}</span>
      {mode === "image" && <span className={styles.track} aria-hidden="true"><i /></span>}
    </div>
  );
}

export default GenerationStatus;
