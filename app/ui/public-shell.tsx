"use client";

import {
  ArrowUpLeft,
  Check,
  ChevronDown,
  Languages,
  Menu,
  Layers3,
  MessageCircleMore,
  WalletCards,
  Moon,
  Sparkles,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Locale, isLocale, tr } from "./i18n";
import type { AuthSessionUser } from "./auth-dialog";
import { type AuthStatus, useAuthSession } from "./auth-session";
import { AccountHub, type HubUsage } from "./account-hub";
import { ToastNotice, type UiNotice } from "./ui-feedback";
import popover from "./account-popover.module.css";
import styles from "./public-shell.module.css";

export type PublicLocale = Locale;

export const publicLocaleMeta = {
  fa: { label: "فارسی", dir: "rtl" as const },
  en: { label: "English", dir: "ltr" as const },
  ar: { label: "العربية", dir: "rtl" as const },
  zh: { label: "中文", dir: "ltr" as const },
};

export function PublicLogo({ compact = false }: { compact?: boolean }) {
  return (
    <Image
      unoptimized
      className={compact ? `${styles.logo} ${styles.logoCompact}` : styles.logo}
      src="/portal-ai-logo.png"
      width={80}
      height={80}
      alt=""
      aria-hidden="true"
      priority={!compact}
    />
  );
}

export type PublicSessionContext = {
  status: AuthStatus;
  isAuthenticated: boolean;
  user: AuthSessionUser | null;
  csrfToken: string;
  workspaceHref: string;
  startHref: string;
  refresh: () => Promise<void>;
  adopt: (user: AuthSessionUser, csrfToken: string) => void;
  clear: () => void;
};

// Observe only newly inserted reveal elements. Streaming updates never rescan
// the entire chat, and effect remounts cannot strand content in a hidden state.
export function useRevealObserver() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pending = new Set<HTMLElement>();
    const queued = new Set<HTMLElement>();
    const shouldReduceMotion = () => media.matches || document.documentElement.dataset.motion === "reduced";
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          observer?.unobserve(entry.target);
          pending.delete(entry.target as HTMLElement);
        }
      },
      { threshold: 0.06, rootMargin: "0px 0px -4% 0px" },
    );
    const attachElement = (element: HTMLElement) => {
      if (element.classList.contains("is-revealed") || pending.has(element)) return;
      if (!observer || shouldReduceMotion()) {
        element.classList.add("is-revealed");
      } else {
        pending.add(element);
        observer.observe(element);
      }
    };
    const attach = (root: HTMLElement) => {
      if (root.matches("[data-reveal]")) attachElement(root);
      root.querySelectorAll<HTMLElement>("[data-reveal]").forEach(attachElement);
    };
    const revealPending = () => {
      if (!shouldReduceMotion()) return;
      for (const element of pending) {
        element.classList.add("is-revealed");
        observer?.unobserve(element);
      }
      pending.clear();
    };
    let frame = 0;
    const mutation = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLElement) queued.add(node);
      }
      if (!queued.size || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        for (const node of queued) if (node.isConnected) attach(node);
        queued.clear();
        for (const element of pending) {
          if (element.isConnected) continue;
          observer?.unobserve(element);
          pending.delete(element);
        }
      });
    });
    const preference = new MutationObserver(revealPending);
    attach(document.body);
    mutation.observe(document.body, { childList: true, subtree: true });
    preference.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    media.addEventListener("change", revealPending);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutation.disconnect();
      preference.disconnect();
      media.removeEventListener("change", revealPending);
    };
  }, []);
}

export function PublicShell({
  children,
  active,
}: {
  children: (locale: PublicLocale, session: PublicSessionContext) => ReactNode;
  active?: "models" | "plans" | "account";
}) {
  const [locale, setLocale] = useState<PublicLocale>("fa");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [usageState, setUsageState] = useState<{ userId: string; value: HubUsage } | null>(null);
  const [notice, setNotice] = useState<UiNotice>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const desktopNavRef = useRef<HTMLElement>(null);
  const logoutPending = useRef(false);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  const closeNotice = useCallback(() => setNotice(null), []);
  const auth = useAuthSession();
  const usage = usageState?.userId === auth.user?.id ? usageState?.value || null : null;
  useRevealObserver();
  const t = tr(locale);
  const dir = publicLocaleMeta[locale].dir;
  const isAuthenticated = Boolean(auth.user) && auth.status !== "anonymous";
  const authPromptAllowed = auth.status === "anonymous";
  const sessionContext: PublicSessionContext = {
    status: auth.status,
    isAuthenticated,
    user: auth.user,
    csrfToken: auth.csrfToken,
    workspaceHref: authPromptAllowed ? "/app?auth=login" : "/app",
    startHref: authPromptAllowed ? "/app?auth=register" : "/app",
    refresh: auth.refresh,
    adopt: auth.adopt,
    clear: auth.clear,
  };

  useEffect(() => {
    let savedTheme: "light" | "dark" = "dark";
    let savedLocale: string | null = null;
    try {
      const savedChoice = window.localStorage.getItem("portal-theme-choice");
      savedTheme = savedChoice === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
        : savedChoice === "light" || savedChoice === "dark" ? savedChoice
          : window.localStorage.getItem("portal-theme") === "light" ? "light" : "dark";
      savedLocale = window.localStorage.getItem("portal-locale");
    } catch { /* Preferences remain usable when browser storage is unavailable. */ }
    document.documentElement.dataset.theme = savedTheme;
    queueMicrotask(() => {
      setTheme(savedTheme);
      if (isLocale(savedLocale)) setLocale(savedLocale);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    try { window.localStorage.setItem("portal-locale", locale); } catch { /* Keep the in-memory preference. */ }
  }, [dir, locale]);

  useEffect(() => {
    const syncTheme = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      try {
        if (window.localStorage.getItem("portal-theme-choice") !== "system") return;
        const resolved = media.matches ? "light" : "dark";
        document.documentElement.dataset.theme = resolved;
        window.localStorage.setItem("portal-theme", resolved);
      } catch { /* Ignore unavailable persistence. */ }
    };
    const syncPreferences = () => {
      try {
        const choice = window.localStorage.getItem("portal-theme-choice");
        const resolved = choice === "system" ? (media.matches ? "light" : "dark")
          : choice === "light" || choice === "dark" ? choice
            : window.localStorage.getItem("portal-theme") === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = resolved;
      } catch { /* The DOM theme remains the authority when storage is blocked. */ }
      syncTheme();
    };
    media.addEventListener("change", syncSystemTheme);
    window.addEventListener("portal-preferences-changed", syncPreferences);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("portal-preferences-changed", syncPreferences);
    };
  }, []);

  useEffect(() => {
    if (!languageOpen && !menuOpen) return;
    const container = languageOpen ? languageRef.current : mobileMenuRef.current;
    const trigger = languageOpen ? languageRef.current?.querySelector<HTMLButtonElement>("button") : menuTriggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      const target = languageOpen ? container?.querySelector<HTMLElement>('[aria-checked="true"]')
        : container?.querySelector<HTMLElement>('[aria-current="page"]') || container?.querySelector<HTMLElement>('a[href]');
      target?.focus();
    });
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        trigger?.focus();
        setLanguageOpen(false);
        setMenuOpen(false);
        return;
      }
      if (languageOpen && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : index < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
      if (event.key !== "Tab") return;
      if (languageOpen) {
        // Continue from the header trigger instead of the last language option.
        trigger?.focus();
        setLanguageOpen(false);
        return;
      }
      const items = [trigger, ...Array.from(container?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || [])]
        .filter((item): item is HTMLElement => Boolean(item && item.getClientRects().length));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!(event.target instanceof Node)) return;
      if (container?.contains(event.target) || trigger?.contains(event.target)) return;
      setLanguageOpen(false);
      setMenuOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 1101px)");
    const closeOnDesktop = () => {
      if (!desktop.matches || !menuOpen) return;
      setMenuOpen(false);
      (desktopNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]') || desktopNavRef.current?.querySelector<HTMLElement>('a[href]'))?.focus();
    };
    window.addEventListener("keydown", closeMenus);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeMenus);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [languageOpen, menuOpen]);

  useEffect(() => {
    if (!accountOpen || !isAuthenticated || !auth.user?.id) return;
    const userId = auth.user.id;
    const controller = new AbortController();
    void fetch("/api/account/usage", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<HubUsage> : null)
      .then((value) => { if (!controller.signal.aborted) setUsageState(value ? { userId, value } : null); })
      .catch(() => { if (!controller.signal.aborted) setUsageState(null); });
    return () => controller.abort();
  }, [accountOpen, isAuthenticated, auth.user?.id]);

  const openAccount = (element: HTMLElement) => {
    setAccountAnchor(element);
    setUsageState(null);
    setAccountOpen((value) => !value);
    setLanguageOpen(false);
    setMenuOpen(false);
  };

  const logout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", credentials: "include", headers: { "x-csrf-token": auth.csrfToken },
      });
      if (!response.ok && response.status !== 401) throw new Error(t.account.toastLogoutFailed);
      auth.clear();
      setUsageState(null);
      closeAccount();
      setNotice({ text: t.account.toastLoggedOut, tone: "success" });
    } catch {
      setNotice({ text: t.account.toastLogoutFailed, tone: "error" });
    } finally { logoutPending.current = false; }
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("portal-theme-choice", next);
      window.localStorage.setItem("portal-theme", next);
      window.dispatchEvent(new Event("portal-preferences-changed"));
    } catch { /* Theme still applies for this visit. */ }
  };

  const nav = [
    { href: "/app", label: t.nav.chat, key: "chat", icon: MessageCircleMore },
    { href: "/models", label: t.nav.models, key: "models", icon: Layers3 },
    { href: "/plans", label: t.nav.plans, key: "plans", icon: WalletCards },
    { href: "/account", label: t.nav.account, key: "account", icon: UserRound },
  ];

  return (
    <div className={styles.site} dir={dir}>
      <a className="skip-link" href="#main-content">{t.nav.skip}</a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="Portal AI">
          <PublicLogo />
          <span>Portal<span className={styles.brandAI}>AI</span></span>
        </Link>

        <nav className={styles.nav} ref={desktopNavRef} aria-label={t.common.menu}>
          {nav.map((item) => (
            <Link
              key={item.key}
              className={active === item.key ? styles.active : undefined}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          <div className={styles.language} ref={languageRef}>
            <button
              type="button"
              onClick={() => { setLanguageOpen((value) => !value); setMenuOpen(false); closeAccount(); }}
              aria-haspopup="menu"
              aria-expanded={languageOpen}
              aria-controls="public-language-menu"
              aria-label={t.common.language}
            >
              <Languages size={18} aria-hidden="true" />
              <span>{publicLocaleMeta[locale].label}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {languageOpen && (
              <div className={styles.languageMenu} id="public-language-menu" role="menu" aria-label={t.common.language}>
                {(Object.keys(publicLocaleMeta) as PublicLocale[]).map((item) => (
                  <button
                    type="button"
                    key={item}
                    className={item === locale ? styles.selectedLanguage : undefined}
                    role="menuitemradio"
                    aria-checked={item === locale}
                    lang={item}
                    dir={publicLocaleMeta[item].dir}
                    onClick={() => { setLocale(item); setLanguageOpen(false); languageRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }}
                  >
                    {publicLocaleMeta[item].label}
                    {item === locale && <Check size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={styles.iconButton}
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t.settings.themeLight : t.settings.themeDark}
            title={theme === "dark" ? t.settings.themeLight : t.settings.themeDark}
          >
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          {isAuthenticated ? <>
            <button
              className={popover.accountTrigger}
              type="button"
              onClick={(event) => openAccount(event.currentTarget)}
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              aria-controls="account-popover"
              aria-label={t.nav.account}
            >
              <span className={popover.triggerAvatar} aria-hidden="true">{auth.user?.username || auth.user?.displayName ? (auth.user.username || auth.user.displayName || "").slice(0, 1).toUpperCase() : <UserRound size={16} />}</span>
              <span className={popover.triggerName} dir="auto">{auth.user?.username || auth.user?.displayName || t.nav.account}</span>
              <ChevronDown size={13} className={popover.triggerChevron} aria-hidden="true" />
            </button>
            <Link className={styles.primary} href="/app">
              {t.nav.chat}<ArrowUpLeft className={styles.directionalArrow} size={17} aria-hidden="true" />
            </Link>
          </> : auth.status === "checking" ? (
            <span className={styles.sessionChecking} role="status"><i aria-hidden="true" />{t.common.checking}</span>
          ) : auth.status === "unavailable" ? (
            <button type="button" className={styles.signIn} onClick={() => void auth.refresh()} title={t.chat.sessionUnavailable}>{t.common.retry}</button>
          ) : <>
            <Link className={styles.signIn} href={sessionContext.workspaceHref}>{t.common.signIn}</Link>
            <Link className={styles.primary} href={sessionContext.startHref}>
              {t.nav.startFree}<ArrowUpLeft className={styles.directionalArrow} size={17} aria-hidden="true" />
            </Link>
          </>}
          <button
            ref={menuTriggerRef}
            className={`${styles.iconButton} ${styles.menuTrigger}`}
            type="button"
            onClick={() => { setMenuOpen((value) => !value); setLanguageOpen(false); closeAccount(); }}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
            aria-label={t.common.menu}
          >
            {menuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
        </div>
        </div>
      </header>

      {menuOpen && (
        <nav className={styles.mobileMenu} ref={mobileMenuRef} id="public-mobile-menu" aria-label={t.common.menu}>
          <div className={styles.mobileMenuHeading}><span>{t.nav.product}</span><span dir="ltr">Portal AI</span></div>
          {nav.map((item) => (
            <Link
              key={item.key}
              className={active === item.key ? styles.active : undefined}
              aria-current={active === item.key ? "page" : undefined}
              href={item.href}
              onClick={() => setMenuOpen(false)}
            >
              <item.icon size={19} aria-hidden="true" /><span>{item.label}</span><ArrowUpLeft className={styles.directionalArrow} size={16} aria-hidden="true" />
            </Link>
          ))}
          <div className={styles.mobileActions}>
            {isAuthenticated ? <>
              <Link className={styles.secondary} href="/account" onClick={() => setMenuOpen(false)}>
                {t.nav.account}
              </Link>
              <Link className={styles.primary} href="/app" onClick={() => setMenuOpen(false)}>
                {t.common.workspace}<ArrowUpLeft className={styles.directionalArrow} size={16} aria-hidden="true" />
              </Link>
            </> : auth.status === "checking" ? (
              <span className={styles.sessionChecking} role="status">{t.common.checking}</span>
            ) : auth.status === "unavailable" ? (
              <button type="button" className={styles.secondary} onClick={() => void auth.refresh()}>{t.common.retry}</button>
            ) : <>
              <Link className={styles.secondary} href={sessionContext.workspaceHref} onClick={() => setMenuOpen(false)}>
                {t.common.signIn}
              </Link>
              <Link className={styles.primary} href={sessionContext.startHref} onClick={() => setMenuOpen(false)}>
                {t.nav.startFree}<ArrowUpLeft className={styles.directionalArrow} size={16} aria-hidden="true" />
              </Link>
            </>}
          </div>
        </nav>
      )}

      {accountOpen && (
        <AccountHub
          key={auth.user?.id || "guest"}
          anchor={accountAnchor}
          locale={locale}
          user={auth.user}
          authStatus={auth.status}
          usage={usage}
          csrf={auth.csrfToken}
          onClose={closeAccount}
          onOpenAuth={() => { window.location.assign(sessionContext.workspaceHref); }}
          onLocaleChange={setLocale}
          onLogout={() => { void logout(); }}
          onSavedUsername={() => { void auth.refresh(); }}
          onPrefsChange={() => undefined}
          pushNotice={(text, tone = "info") => setNotice({ text, tone })}
        />
      )}
      <ToastNotice notice={notice} onClose={closeNotice} locale={locale} />

      <main id="main-content" tabIndex={-1}>{children(locale, sessionContext)}</main>

      <footer className={styles.footer}>
        <div className={styles.footerMain}>
          <div>
            <Link className={styles.brand} href="/">
              <PublicLogo compact />
              <span>Portal<span className={styles.brandAI}>AI</span></span>
            </Link>
            <p>{t.nav.footerTagline}</p>
          </div>
          <div className={styles.footerLinks}>
            <section>
              <b>{t.nav.product}</b>
              <Link href="/app">{t.nav.chat}</Link>
              <Link href="/models">{t.nav.models}</Link>
              <Link href="/plans">{t.nav.plans}</Link>
            </section>
            <section>
              <b>{t.nav.explore}</b>
              <Link href="/account">{t.nav.account}</Link>
              <a href="mailto:support@portal-ai.ir">{t.nav.help}</a>
              <Link href="/settings">{t.nav.settings}</Link>
            </section>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span dir="ltr">© 2026 Portal AI</span>
          <div>
            <Link href="/privacy">{t.nav.privacy}</Link>
            <Link href="/terms">{t.nav.terms}</Link>
          </div>
          <span className={styles.footerNote}><Sparkles size={14} aria-hidden="true" /> {t.nav.madeFor}</span>
        </div>
      </footer>

    </div>
  );
}
