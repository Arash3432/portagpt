"use client";

import Image from "next/image";
import { Check, Download, ImageOff, ImagePlus, LoaderCircle, Maximize2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ownedAssetPath } from "../../lib/asset-url";
import { isRtl, type Locale } from "./i18n";
import styles from "./generated-image.module.css";

const labels = {
  fa: { title: "تصویر شما آماده است", loading: "در حال بارگذاری تصویر…", preview: "نمایش در اندازه اصلی", download: "دانلود تصویر", downloading: "در حال دریافت…", saved: "دانلود آغاز شد", failed: "تصویر بارگذاری نشد.", retry: "تلاش دوباره", downloadFailed: "دانلود انجام نشد؛ دوباره تلاش کنید.", sessionExpired: "برای دریافت تصویر دوباره وارد حساب شوید." },
  en: { title: "Your image is ready", loading: "Loading image…", preview: "View original size", download: "Download image", downloading: "Downloading…", saved: "Download started", failed: "The image could not load.", retry: "Try again", downloadFailed: "Download failed. Please try again.", sessionExpired: "Sign in again to download this image." },
  ar: { title: "صورتك جاهزة", loading: "جارٍ تحميل الصورة…", preview: "عرض بالحجم الأصلي", download: "تنزيل الصورة", downloading: "جارٍ التنزيل…", saved: "بدأ التنزيل", failed: "تعذر تحميل الصورة.", retry: "المحاولة مجدداً", downloadFailed: "تعذر التنزيل. حاول مجدداً.", sessionExpired: "سجّل الدخول مجدداً لتنزيل الصورة." },
  zh: { title: "图片已生成", loading: "正在加载图片…", preview: "查看原图", download: "下载图片", downloading: "正在下载…", saved: "下载已开始", failed: "图片加载失败。", retry: "重试", downloadFailed: "下载失败，请重试。", sessionExpired: "请重新登录以下载图片。" },
};

const imageExtensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** The keyed child resets image and download state when a conversation changes its asset. */
export function GeneratedImage({ src, alt, lang = "fa" }: { src: string; alt: string; lang?: Locale }) {
  return <ImageCard key={src} src={src} alt={alt} lang={lang} />;
}

function ImageCard({ src, alt, lang }: { src: string; alt: string; lang: Locale }) {
  const text = labels[lang];
  const assetPath = ownedAssetPath(src);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">(assetPath ? "loading" : "error");
  const [attempt, setAttempt] = useState(0);
  const [ratio, setRatio] = useState("1 / 1");
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [downloadError, setDownloadError] = useState("");
  const downloadController = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const cleanupTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const urls = objectUrls.current;
    const timers = cleanupTimers.current;
    return () => {
      downloadController.current?.abort();
      downloadController.current = null;
      for (const timer of timers) clearTimeout(timer);
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      timers.clear();
    };
  }, []);

  async function downloadImage() {
    if (!assetPath || downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    cleanupTimers.current.add(timeout);
    setDownloadError("");
    setDownloadState("loading");
    try {
      const response = await fetch(`${assetPath}?download=1`, {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? "SESSION_EXPIRED" : "DOWNLOAD_FAILED");
      const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "";
      const extension = imageExtensions[mime];
      if (!extension || Number(response.headers.get("content-length") || 0) > 20 * 1024 * 1024) throw new Error("INVALID_IMAGE");
      const blob = await response.blob();
      if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error("INVALID_IMAGE");
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      objectUrls.current.add(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = `portal-image-${assetPath.split("/").pop()}.${extension}`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setDownloadState("success");
      // Safari needs the object URL to outlive the click that starts its download.
      const revokeTimer = setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
        cleanupTimers.current.delete(revokeTimer);
      }, 60_000);
      cleanupTimers.current.add(revokeTimer);
      const statusTimer = setTimeout(() => {
        setDownloadState((current) => current === "success" ? "idle" : current);
        cleanupTimers.current.delete(statusTimer);
      }, 3000);
      cleanupTimers.current.add(statusTimer);
    } catch (error) {
      // Cleanup aborts on unmount must not update detached components.
      if (downloadController.current !== controller) return;
      setDownloadError(error instanceof Error && error.message === "SESSION_EXPIRED" ? text.sessionExpired : text.downloadFailed);
      setDownloadState("error");
    } finally {
      clearTimeout(timeout);
      cleanupTimers.current.delete(timeout);
      if (downloadController.current === controller) downloadController.current = null;
    }
  }

  const downloadLabel = downloadState === "loading" ? text.downloading : downloadState === "success" ? text.saved : text.download;

  return (
    <figure className={styles.card} dir={isRtl(lang) ? "rtl" : "ltr"}>
      <div className={styles.media} data-state={imageState} style={{ aspectRatio: ratio }} aria-busy={imageState === "loading"}>
        {assetPath && imageState !== "error" ? (
          <Image
            className={styles.image}
            key={attempt}
            src={attempt ? `${assetPath}?retry=${attempt}` : assetPath}
            alt={alt || text.title}
            unoptimized
            fill
            sizes="(max-width: 600px) 85vw, 520px"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) setRatio(`${image.naturalWidth} / ${image.naturalHeight}`);
              setImageState("ready");
            }}
            onError={() => setImageState("error")}
          />
        ) : null}
        {imageState === "loading" ? (
          <div className={styles.placeholder} role="status">
            <span className={styles.placeholderIcon}><ImagePlus size={25} aria-hidden="true" /></span>
            <span>{text.loading}</span>
          </div>
        ) : imageState === "error" ? (
          <div className={styles.placeholder} role="status">
            <ImageOff size={28} aria-hidden="true" />
            <span>{text.failed}</span>
            {assetPath ? <button type="button" className={styles.retry} onClick={() => { setAttempt((value) => value + 1); setImageState("loading"); }}><RotateCcw size={15} aria-hidden="true" />{text.retry}</button> : null}
          </div>
        ) : null}
        {assetPath && imageState === "ready" ? (
          <a className={styles.expand} href={assetPath} target="_blank" rel="noopener noreferrer" aria-label={text.preview} title={text.preview}>
            <Maximize2 size={17} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.captionLabel}><ImagePlus size={15} aria-hidden="true" /><span>{text.title}</span></span>
        <button type="button" className={styles.download} onClick={() => void downloadImage()} disabled={!assetPath || downloadState === "loading"} aria-label={downloadLabel} title={text.download}>
          {downloadState === "loading" ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : downloadState === "success" ? <Check size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
          <span>{downloadLabel}</span>
        </button>
      </figcaption>
      <div className={downloadError ? styles.error : styles.status} role="status" aria-live="polite" aria-atomic="true">
        {downloadError || (downloadState === "success" ? text.saved : "")}
      </div>
    </figure>
  );
}
