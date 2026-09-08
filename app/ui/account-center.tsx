"use client";

import {
  ArrowUpLeft,
  CheckCircle2,
  Clock3,
  Image as ImageIcon,
  Laptop,
  LogIn,
  LogOut,
  MessageCircleMore,
  MonitorSmartphone,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  WalletCards,
  X,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthDialog, type AuthSessionUser } from "./auth-dialog";
import { PublicLocale, PublicSessionContext, PublicShell } from "./public-shell";
import { ToastNotice, type UiNotice } from "./ui-feedback";
import { fill, fmtDate, fmtNum, tr } from "./i18n";
import styles from "./pages-refined.module.css";

type SessionUser = AuthSessionUser & { email?: string };
type Usage = { text: Array<{ window: string; used: number; limit: number; usedPercent: number; resetAt: string }>; image: { used: number; limit: number; usedPercent: number; window: string; resetAt: string } };
type Device = { id: string; device: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };

export function AccountCenter() {
  return <PublicShell active="account">{(locale, session) => <AccountContent locale={locale} session={session} />}</PublicShell>;
}

function AccountContent({ locale, session }: { locale: PublicLocale; session: PublicSessionContext }) {
  const t = tr(locale);
  const user = session.user as SessionUser | null;
  const csrf = session.csrfToken;
  const [usage, setUsage] = useState<Usage | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [usageError, setUsageError] = useState(false);
  const [devicesError, setDevicesError] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [notice, setNotice] = useState<UiNotice>(null);
  const requestVersion = useRef(0);
  const pushNotice = (text: string, tone: "success" | "error" | "info" = "info") => setNotice({ text, tone });
  const closeNotice = useCallback(() => setNotice(null), []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (session.status !== "authenticated" || !session.user) {
      setUsage(null); setDevices([]); setLoading(false); setLoadedOwner(null);
      setUsageError(false); setDevicesError(false);
      return;
    }
    setLoading(true);
    const read = async (path: string) => {
      const response = await fetch(path, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("account_unavailable");
      return response.json();
    };
    const [usageResult, devicesResult] = await Promise.allSettled([read("/api/account/usage"), read("/api/account/sessions")]);
    if (version !== requestVersion.current) return;
    const validUsage = usageResult.status === "fulfilled" && Array.isArray(usageResult.value?.text) && !!usageResult.value?.image;
    const validDevices = devicesResult.status === "fulfilled" && Array.isArray(devicesResult.value?.sessions);
    setUsage(validUsage && usageResult.status === "fulfilled" ? usageResult.value : null);
    setDevices(validDevices && devicesResult.status === "fulfilled" ? devicesResult.value.sessions : []);
    setUsageError(!validUsage); setDevicesError(!validDevices);
    setLoadedOwner(session.user.id); setLoading(false);
  }, [session.status, session.user]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const closeTimer = window.setTimeout(() => setAuthOpen(false), 0);
    return () => window.clearTimeout(closeTimer);
  }, [session.status]);

  const revoke = async (device?: Device) => {
    if (actionLock.current || !csrf || session.status !== "authenticated") return;
    actionLock.current = true;
    const version = requestVersion.current;
    setPendingAction(device?.id || "all");
    try {
      const response = await fetch("/api/account/sessions", { method: "DELETE", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(device ? { sessionId: device.id } : { others: true }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t.account.toastRevokeFailed);
      if (version !== requestVersion.current) return;
      setDevices((current) => device ? current.filter((item) => item.id !== device.id) : current.filter((item) => item.current));
      pushNotice(device ? t.account.toastRevokedOne : t.account.toastRevokedAll, "success");
    } catch (error) { if (version === requestVersion.current) pushNotice(error instanceof Error ? error.message : t.account.toastActionFailed, "error"); }
    finally { actionLock.current = false; setPendingAction(null); }
  };

  const logout = async () => {
    if (actionLock.current || !csrf) return;
    actionLock.current = true; setPendingAction("logout");
    const version = requestVersion.current;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { "x-csrf-token": csrf } });
      if (!response.ok) throw new Error(t.account.toastLogoutFailed);
      if (version !== requestVersion.current) return;
      requestVersion.current += 1;
      setDevices([]); setUsage(null); session.clear(); pushNotice(t.account.toastLoggedOut, "success");
    } catch (error) {
      if (version === requestVersion.current) pushNotice(error instanceof Error ? error.message : t.account.toastLogoutFailed, "error");
    } finally { actionLock.current = false; setPendingAction(null); }
  };

  const usageLine = (item: { used: number; limit: number } | undefined) =>
    item ? fill(t.account.usageOf, { used: fmtNum(locale, item.used), limit: fmtNum(locale, item.limit) }) : t.account.usageNone;
  const currentUsage = loadedOwner === user?.id ? usage : null;
  const currentDevices = loadedOwner === user?.id ? devices : [];
  const isLoadingDetails = loading || loadedOwner !== user?.id;
  const detail = {
    fa: { emptyDevices: "نشست فعالی برای نمایش دریافت نشد.", reset: "شروع بازه بعدی", refreshing: "در حال به‌روزرسانی…", used: "مصرف شده" },
    en: { emptyDevices: "No active sessions were returned.", reset: "Next reset", refreshing: "Updating…", used: "Used" },
    ar: { emptyDevices: "لم يتم العثور على جلسات نشطة.", reset: "التجديد التالي", refreshing: "جارٍ التحديث…", used: "مستخدم" },
    zh: { emptyDevices: "未返回活动会话。", reset: "下次重置", refreshing: "正在更新…", used: "已使用" },
  }[locale];
  const threeHourUsage = currentUsage?.text.find((item) => item.window === "3 hours") || currentUsage?.text[0];
  const weeklyUsage = currentUsage?.text.find((item) => item.window === "week") || currentUsage?.text[1];

  return <>
    <section className={`${styles.refined} ${styles.accountPage} account-page public-container`}>
      {session.status === "checking" ? <div className="account-loading" role="status"><i aria-hidden="true" /><b>{t.account.loading}</b></div> : session.status === "unavailable" ? <div className="account-guest" data-reveal><span><ShieldCheck size={30} /></span><h1>{t.account.unavailableTitle}</h1><p>{t.account.unavailableDesc}</p><button type="button" className="public-primary is-large" onClick={() => void session.refresh()}><LogIn size={19} />{t.common.retry}</button></div> : !user ? <div className="account-guest" data-reveal><span><UserRound size={30} /></span><h1>{t.account.guestTitle}</h1><p>{t.account.guestDesc}</p><button type="button" className="public-primary is-large" onClick={() => setAuthOpen(true)}><LogIn size={19} />{t.account.guestButton}</button><small>{t.account.guestHint}</small></div> : <>
        <header className="account-heading" data-reveal><div><span>{t.account.eyebrow}</span><h1>{t.account.welcome}{user.username || user.displayName ? `، ${user.username || user.displayName}` : ""}</h1><p>{t.account.welcomeDesc}</p></div><div className="account-heading-actions"><Link className="public-secondary" href="/settings"><Settings size={17} />{t.nav.settings}</Link><button type="button" disabled={!!pendingAction || !csrf} aria-busy={pendingAction === "logout"} onClick={() => void logout()}><LogOut size={17} />{t.common.signOut}</button></div></header>

        <div className="account-overview" data-reveal>
          <article className="profile-card"><div className="profile-avatar">{(user.username || user.displayName || "P").slice(0, 1).toUpperCase()}</div><div><span className="profile-status"><i /> {t.account.profileActive}</span><h2>{user.username || user.displayName || t.account.defaultName}</h2><p dir="ltr">{user.phoneMasked}</p>{user.email && <small dir="ltr">{user.email}</small>}</div><Link href="/settings">{t.account.editSettings}<ArrowUpLeft size={16} /></Link></article>
          <article className="subscription-card"><header><span><WalletCards size={19} /></span><div><small>{t.account.currentPlanLabel}</small><h2>{user.plan}</h2></div><CheckCircle2 size={20} /></header><p>{user.plan === "free" ? t.account.planFreeDesc : t.account.planPaidDesc}</p><Link className="public-primary" href="/plans">{t.account.viewPlans}<ArrowUpLeft size={16} /></Link></article>
        </div>

        <section className="account-usage" aria-busy={isLoadingDetails}><header><div><span>{t.account.usageEyebrow}</span><h2>{t.account.usageTitle}</h2></div><button className={styles.smallAction} type="button" disabled={isLoadingDetails || !!pendingAction} onClick={() => void load()}><RefreshCw size={15} />{isLoadingDetails ? detail.refreshing : t.common.retry}</button></header>
          {isLoadingDetails ? <div className={styles.usageSkeleton} role="status" aria-label={t.account.loading}>{[0, 1, 2].map((item) => <div className={styles.skeletonCard} key={item}><i /><i /></div>)}</div> : usageError ? <div className={styles.inlineError} role="alert"><ShieldCheck size={20} /><p>{t.account.toastLoadFailed}</p><button type="button" onClick={() => void load()}>{t.common.retry}</button></div> : <div className={styles.usageGrid}>{[
            { item: threeHourUsage, label: t.account.usage3h, Icon: MessageCircleMore },
            { item: weeklyUsage, label: t.account.usageWeekly, Icon: Clock3 },
            { item: currentUsage?.image, label: t.account.usageImage, Icon: ImageIcon },
          ].map(({ item, label, Icon }) => {
            const percent = item ? Math.max(0, Math.min(100, Number.isFinite(item.usedPercent) ? item.usedPercent : 0)) : 0;
            return <article className={styles.usageCard} key={label}><header><span><Icon size={19} />{label}</span><b>{item ? `${fmtNum(locale, Math.round(percent))}%` : "—"}</b></header><strong>{usageLine(item)}</strong><div className={styles.usageTrack} role="meter" aria-label={`${label} — ${detail.used}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={usageLine(item)}><span style={{ width: `${percent}%` }} data-warning={percent >= 85} /></div>{item?.resetAt && <small>{detail.reset}: {fmtDate(locale, item.resetAt, { dateStyle: "short", timeStyle: "short" })}</small>}</article>;
          })}</div>}
        </section>

        <section className="account-devices" aria-busy={isLoadingDetails}><header><div><span><Laptop size={19} /></span><div><h2>{t.account.devicesTitle}</h2><p>{t.account.devicesDesc}</p></div></div>{!isLoadingDetails && currentDevices.some((device) => !device.current) && <button type="button" disabled={!!pendingAction || !csrf} aria-busy={pendingAction === "all"} onClick={() => void revoke()}>{t.account.revokeAll}</button>}</header>
          {isLoadingDetails ? <div className={styles.deviceLoading} role="status">{t.account.loading}</div> : devicesError ? <div className={styles.inlineError} role="alert"><ShieldCheck size={20} /><p>{t.account.toastLoadFailed}</p><button type="button" onClick={() => void load()}>{t.common.retry}</button></div> : !currentDevices.length ? <div className={styles.deviceLoading}><MonitorSmartphone size={23} /><p>{detail.emptyDevices}</p><button className={styles.smallAction} type="button" onClick={() => void load()}>{t.common.retry}</button></div> : <div>{currentDevices.map((device) => <article key={device.id}><span><MonitorSmartphone size={20} /></span><div><b>{device.device}</b><small><Clock3 size={13} /> {t.account.lastSeen} {fmtDate(locale, device.lastSeenAt, { dateStyle: "medium", timeStyle: "short" })}</small></div>{device.current ? <em><i /> {t.account.thisDevice}</em> : <button type="button" disabled={!!pendingAction || !csrf} aria-busy={pendingAction === device.id} aria-label={`${t.account.revoke}: ${device.device}`} onClick={() => void revoke(device)}><X size={15} />{t.account.revoke}</button>}</article>)}</div>}
        </section>

        <section className="account-shortcuts" data-reveal><Link href="/app"><span><MessageCircleMore size={20} /></span><div><b>{t.account.shortcutsChatTitle}</b><p>{t.account.shortcutsChatDesc}</p></div><ArrowUpLeft size={17} /></Link><Link href="/models"><span><Sparkles size={20} /></span><div><b>{t.account.shortcutsModelsTitle}</b><p>{t.account.shortcutsModelsDesc}</p></div><ArrowUpLeft size={17} /></Link><Link href="/settings"><span><ShieldCheck size={20} /></span><div><b>{t.account.shortcutsSettingsTitle}</b><p>{t.account.shortcutsSettingsDesc}</p></div><ArrowUpLeft size={17} /></Link></section>
      </>}
    </section>
    {authOpen && <AuthDialog locale={locale} onClose={() => setAuthOpen(false)} onAuthenticated={(nextUser, token) => { session.adopt(nextUser, token); setAuthOpen(false); void session.refresh(); }} />}
    <ToastNotice notice={notice} onClose={closeNotice} locale={locale} />
  </>;
}
