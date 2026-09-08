"use client";

// A compact account popover follows its trigger. Detailed settings open in a
// separate accessible dialog without replacing the current workspace.

import {
  ArrowUpLeft,
  Check,
  ChevronRight,
  Image as ImageIcon,
  Languages,
  Layers3,
  LogOut,
  MessageCircleMore,
  Moon,
  Palette,
  Pencil,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import popover from "./account-popover.module.css";
import type { AuthSessionUser } from "./auth-dialog";
import { fill, fmtNum, localeMeta, tr, type Locale } from "./i18n";
import styles from "./portal-app.module.css";

export type HubUsage = {
  text: Array<{ window: string; used: number; limit: number; usedPercent: number; resetAt: string }>;
  image: { used: number; limit: number; usedPercent: number; window: string; resetAt?: string };
};

export type HubUser = AuthSessionUser & { email?: string };

type HubPanel = "profile" | "subscription" | "appearance" | "language" | "more" | null;

function readPreference(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}

function notifyPreferenceChange() {
  window.dispatchEvent(new Event("portal-preferences-changed"));
}


const planBadgeClass: Record<string, string> = {
  free: styles.planBadgeFree,
  starter: styles.planBadgeStarter,
  plus: styles.planBadgePlus,
  pro: styles.planBadgePro,
  ultra: styles.planBadgeUltra,
};

export function PlanBadge({ plan }: { plan: string }) {
  return (
    <em className={`${styles.planBadge} ${planBadgeClass[plan] || styles.planBadgeFree}`} dir="ltr">
      {plan}
    </em>
  );
}

export function QuotaBar({
  value,
  label,
  hint,
}: {
  value: number;
  label: string;
  hint?: string;
}) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  return (
    <div className={`${styles.hubQuotaRow} ${popover.quotaRow}`}>
      <div className={`${styles.hubQuotaText} ${popover.quotaText}`}>
        <span>{label}</span>
        <small>{hint}</small>
      </div>
      <span className={`${styles.hubQuotaTrack} ${popover.quotaTrack}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe} aria-valuetext={hint || `${safe}%`} data-level={safe >= 100 ? "full" : safe >= 80 ? "high" : "normal"}>
        <i style={{ inlineSize: `${safe}%` } as CSSProperties} />
      </span>
    </div>
  );
}

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Position in the viewport, outside any scrolling/clipped sidebar. Keep the
// element measurable before revealing it to prevent a flash at the wrong edge.
function useAccountPosition(
  anchor: HTMLElement | null | undefined,
  popoverRef: RefObject<HTMLDivElement | null>,
  isRtl: boolean,
) {
  useLayoutEffect(() => {
    const element = popoverRef.current;
    if (!element) return;
    let frame = 0;
    const position = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft || 0;
      const y = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const margin = 12;
      const gap = 9;
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      const availableWidth = Math.max(1, width - margin * 2);
      element.style.width = `${Math.min(320, availableWidth)}px`;
      const naturalHeight = element.scrollHeight + 2;
      const below = rect ? y + height - rect.bottom - gap - margin : height - margin * 2;
      const above = rect ? rect.top - y - gap - margin : 0;
      const placeAbove = Boolean(rect && below < naturalHeight && above > below);
      const maxHeight = Math.max(1, Math.min(height - margin * 2, Math.max(above, below)));
      element.style.maxHeight = `${maxHeight}px`;
      const actualHeight = Math.min(naturalHeight, maxHeight);
      const actualWidth = element.getBoundingClientRect().width;
      const start = rect ? (isRtl ? rect.left : rect.right - actualWidth) : x + width - actualWidth - margin;
      const top = rect ? (placeAbove ? rect.top - gap - actualHeight : rect.bottom + gap) : y + margin;
      element.style.left = `${Math.max(x + margin, Math.min(start, x + width - actualWidth - margin))}px`;
      element.style.top = `${Math.max(y + margin, Math.min(top, y + height - actualHeight - margin))}px`;
      const origin = rect ? Math.max(20, Math.min(actualWidth - 20, rect.left + rect.width / 2 - Number.parseFloat(element.style.left))) : actualWidth - 24;
      element.style.transformOrigin = `${origin}px ${placeAbove ? "bottom" : "top"}`;
      element.dataset.placement = placeAbove ? "top" : "bottom";
      element.dataset.positioned = "true";
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; position(); });
    };
    position();
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    if (anchor) resize.observe(anchor);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [anchor, popoverRef, isRtl]);
}

function useHubA11y(
  panel: HubPanel,
  anchor: HTMLElement | null | undefined,
  layerRef: RefObject<HTMLDivElement | null>,
  popoverRef: RefObject<HTMLDivElement | null>,
  dialogRef: RefObject<HTMLDivElement | null>,
  closePanel: () => void,
  closeHub: () => void,
) {
  const restoreFocus = useRef(true);
  const onCloseHub = useEffectEvent(closeHub);
  const onClosePanel = useEffectEvent(closePanel);

  useEffect(() => {
    const originalFocus = anchor || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    return () => {
      if (restoreFocus.current && originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    const container = panel ? dialogRef.current : popoverRef.current;
    if (!container) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const inactiveElements: Array<{ element: HTMLElement; wasInert: boolean }> = [];
    if (panel) {
      document.body.style.overflow = "hidden";
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child === layerRef.current || child.contains(layerRef.current)) continue;
        inactiveElements.push({ element: child, wasInert: child.inert });
        child.inert = true;
      }
    }
    const focus = window.requestAnimationFrame(() => {
      const target = !panel && previousFocus && container.contains(previousFocus)
        ? previousFocus
        : container.querySelector<HTMLElement>(panel ? "[data-hub-autofocus]" : '[role="menuitem"]') || container.querySelector<HTMLElement>(focusableSelector);
      (target || container).focus({ preventScroll: true });
    });
    const onPointerDown = (event: PointerEvent) => {
      if (panel || !(event.target instanceof Node) || container.contains(event.target) || anchor?.contains(event.target)) return;
      restoreFocus.current = false;
      onCloseHub();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || container.contains(event.target)) return;
      if (panel) {
        (container.querySelector<HTMLElement>(focusableSelector) || container).focus({ preventScroll: true });
        return;
      }
      if (anchor?.contains(event.target)) return;
      restoreFocus.current = false;
      onCloseHub();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (panel) onClosePanel();
        else onCloseHub();
        return;
      }
      if (!panel && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : index < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
      if (event.key !== "Tab") return;
      if (!panel) {
        // Return to the trigger before native Tab so portaling does not send
        // keyboard users to the very end of the document.
        restoreFocus.current = false;
        anchor?.focus({ preventScroll: true });
        onCloseHub();
        return;
      }
      const items = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) =>
        item.tabIndex >= 0 && !item.closest('[inert], [hidden], [aria-hidden="true"]') &&
        item.getClientRects().length > 0 && window.getComputedStyle(item).visibility !== "hidden",
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); container.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focus);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
      if (panel) {
        document.body.style.overflow = previousOverflow;
        for (const { element, wasInert } of inactiveElements) element.inert = wasInert;
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }
    };
  }, [panel, anchor, layerRef, popoverRef, dialogRef]);
}

export type AccountHubProps = {
  anchor?: HTMLElement | null;
  locale: Locale;
  user: HubUser | null;
  authStatus: "checking" | "authenticated" | "anonymous" | "unavailable";
  usage: HubUsage | null;
  csrf: string;
  onClose: () => void;
  onOpenAuth: () => void;
  onLocaleChange: (locale: Locale) => void;
  onLogout: () => void;
  onSavedUsername: () => void;
  onPrefsChange: (prefs: { sendOnEnter?: boolean; showSuggestions?: boolean }) => void;
  pushNotice: (text: string, tone?: "success" | "error" | "info") => void;
};

export function AccountHub({
  anchor,
  locale,
  user,
  authStatus,
  usage,
  csrf,
  onClose,
  onOpenAuth,
  onLocaleChange,
  onLogout,
  onSavedUsername,
  onPrefsChange,
  pushNotice,
}: AccountHubProps) {
  const t = tr(locale).hub;
  const close = tr(locale).common;
  const [panel, setPanel] = useState<HubPanel>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closePanel = () => setPanel(null);
  useHubA11y(panel, anchor, layerRef, drawerRef, dialogRef, closePanel, onClose);
  useAccountPosition(anchor, drawerRef, localeMeta[locale].dir === "rtl");

  const displayName = user?.username || user?.displayName || user?.phoneMasked || "";
  const avatarLetter = (user?.username || user?.displayName || "P").slice(0, 1).toUpperCase();
  const textUsage = usage?.text.find((item) => item.window === "3 hours") || usage?.text[0];
  const isRtl = localeMeta[locale].dir === "rtl";

  const panelTitles: Record<Exclude<HubPanel, null>, string> = {
    profile: t.profile,
    subscription: t.subscription,
    appearance: t.appearance,
    language: t.language,
    more: t.more,
  };

  const menu: Array<{ key: Exclude<HubPanel, null>; icon: typeof UserRound }> = [
    { key: "profile", icon: UserRound },
    { key: "subscription", icon: WalletCards },
    { key: "appearance", icon: Palette },
    { key: "language", icon: Languages },
    { key: "more", icon: Settings2 },
  ];

  const menuCopy: Record<Exclude<HubPanel, null>, { title: string; desc: string }> = {
    profile: { title: t.profile, desc: t.profileDesc },
    subscription: { title: t.subscription, desc: t.subscriptionDesc },
    appearance: { title: t.appearance, desc: t.appearanceDesc },
    language: { title: t.language, desc: t.languageDesc },
    more: { title: t.more, desc: t.moreDesc },
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={popover.layer} ref={layerRef} dir={localeMeta[locale].dir}>
      <div className={popover.card} ref={drawerRef} id="account-popover" role="dialog" aria-label={t.drawerTitle} tabIndex={-1} inert={Boolean(panel)}>

        <header className={`${styles.hubHead} ${popover.header}`}>
          {user ? (
            <div className={styles.hubIdentity}>
              <span className={`${styles.hubAvatar} ${popover.avatar}`} aria-hidden="true">
                {avatarLetter}
              </span>
              <div className={`${styles.hubIdentityText} ${popover.identityText}`}>
                <b dir="auto">{displayName}</b>
                <small dir="ltr">{user.phoneMasked}</small>
              </div>
              <PlanBadge plan={user.plan} />
            </div>
          ) : (
            <div className={styles.hubIdentity}>
              <span className={`${styles.hubAvatar} ${styles.hubAvatarGhost}`} aria-hidden="true">
                <UserRound size={20} />
              </span>
              <div className={`${styles.hubIdentityText} ${popover.identityText}`}>
                <b>{t.guestTitle}</b>
                <small>{t.guestDesc}</small>
              </div>
            </div>
          )}
          <button className={styles.hubClose} type="button" onClick={onClose} aria-label={close.close} data-hub-autofocus>
            <X size={17} />
          </button>
        </header>

        {user ? (
          <>
            {usage && (textUsage || usage.image) && (
              <section className={`${styles.hubQuota} ${popover.quota}`} aria-label={t.subscription}>
                {textUsage && (
                  <QuotaBar
                    value={textUsage.usedPercent}
                    label={t.quota3h}
                    hint={fill(t.quotaOf, {
                      used: fmtNum(locale, textUsage.used),
                      limit: fmtNum(locale, textUsage.limit),
                    })}
                  />
                )}
                <QuotaBar
                  value={usage.image.usedPercent}
                  label={t.quotaImage}
                  hint={fill(t.quotaOf, {
                    used: fmtNum(locale, usage.image.used),
                    limit: fmtNum(locale, usage.image.limit),
                  })}
                />
              </section>
            )}

            <nav className={`${styles.hubMenu} ${popover.menu}`} role="menu" aria-label={t.drawerTitle}>
              {menu.map(({ key, icon: Icon }) => (
                <button
                  className={`${styles.hubItem} ${popover.item}`}
                  role="menuitem"
                  key={key}
                  type="button"
                  onClick={() => setPanel(key)}
                  aria-haspopup="dialog"
                >
                  <span className={`${styles.hubItemIcon} ${popover.itemIcon}`}>
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span className={`${styles.hubItemText} ${popover.itemText}`}>
                    <b>{menuCopy[key].title}</b>
                    <small>{menuCopy[key].desc}</small>
                  </span>
                  <ChevronRight size={16} className={styles.hubItemChevron} aria-hidden="true" />
                </button>
              ))}
            </nav>

            <footer className={`${styles.hubFoot} ${popover.footer}`}>
              <small>
                <Sparkles size={12} aria-hidden="true" />
                {t.drawerHint}
              </small>
            </footer>
          </>
        ) : (
          <div className={styles.hubGuest}>
            <p>
              <MessageCircleMore size={18} aria-hidden="true" />
              {authStatus === "checking" ? t.sessionCheck : t.guestDesc}
            </p>
            {authStatus !== "checking" && (
              <button className={styles.hubGuestAction} type="button" onClick={onOpenAuth}>
                <LogOut size={16} aria-hidden="true" style={isRtl ? { transform: "scaleX(-1)" } : undefined} />
                {t.guestAction}
              </button>
            )}
          </div>
        )}
      </div>

      {panel && (
        <div className={`${styles.hubDialogLayer} ${popover.dialogLayer}`}>
          <button
            className={styles.hubDialogScrim}
            type="button"
            onClick={closePanel}
            aria-label={close.close}
            tabIndex={-1}
          />
          <div className={`${styles.hubDialog} ${popover.dialog}`} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="hub-dialog-title">
            <header className={styles.hubDialogHead}>
              <b id="hub-dialog-title">{panelTitles[panel]}</b>
              <button className={styles.hubClose} type="button" onClick={closePanel} aria-label={close.close} data-hub-autofocus>
                <X size={16} />
              </button>
            </header>
            <div className={styles.hubDialogBody}>
              {panel === "profile" && (
                <ProfilePanel
                  locale={locale}
                  user={user}
                  csrf={csrf}
                  onLogout={onLogout}
                  onSavedUsername={onSavedUsername}
                  pushNotice={pushNotice}
                />
              )}
              {panel === "subscription" && (
                <SubscriptionPanel locale={locale} user={user} usage={usage} onNavigate={onClose} />
              )}
              {panel === "appearance" && (
                <AppearancePanel locale={locale} onPrefsChange={onPrefsChange} />
              )}
              {panel === "language" && <LanguagePanel locale={locale} onLocaleChange={onLocaleChange} />}
              {panel === "more" && <MorePanel locale={locale} role={user?.role} onNavigate={onClose} />}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function ProfilePanel({
  locale,
  user,
  csrf,
  onLogout,
  onSavedUsername,
  pushNotice,
}: {
  locale: Locale;
  user: HubUser | null;
  csrf: string;
  onLogout: () => void;
  onSavedUsername: () => void;
  pushNotice: (text: string, tone?: "success" | "error" | "info") => void;
}) {
  const t = tr(locale).hub;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => () => saveController.current?.abort(), []);
  useEffect(() => { if (editing) usernameInputRef.current?.focus(); }, [editing]);

  const usernamePattern = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

  const save = async () => {
    if (saveController.current) return;
    const candidate = value.trim();
    if (!usernamePattern.test(candidate)) {
      setError(t.usernameInvalid);
      return;
    }
    if (candidate === user?.username) {
      setEditing(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        signal: controller.signal,
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ username: candidate }),
      });
      const body = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || t.usernameFailed);
      setEditing(false);
      pushNotice(t.usernameSaved, "success");
      onSavedUsername();
    } catch (saveError) {
      if (!controller.signal.aborted) setError(saveError instanceof Error ? saveError.message : t.usernameFailed);
    } finally {
      saveController.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  if (!user) return null;
  const avatarLetter = (user.username || user.displayName || "P").slice(0, 1).toUpperCase();

  return (
    <div className={styles.hubProfile}>
      <div className={styles.hubProfileHead}>
        <span className={styles.hubAvatarLarge} aria-hidden="true">
          {avatarLetter}
        </span>
        <div className={styles.hubProfileId}>
          <b dir="auto">{user.username || user.displayName || user.phoneMasked}</b>
          <PlanBadge plan={user.plan} />
        </div>
      </div>

      <div className={`${styles.hubField} ${popover.field}`}>
        <span className={styles.hubFieldLabel}>{t.usernameLabel}</span>
        {editing ? (
          <div className={styles.hubUsernameForm}>
            <input
              ref={usernameInputRef}
              data-hub-autofocus
              dir="ltr"
              value={value}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && !saving) { event.preventDefault(); void save(); }
              }}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby="hub-username-hint"
              aria-busy={saving}
              disabled={saving}
              aria-label={t.usernameLabel}
            />
            <div className={styles.hubUsernameActions}>
              <button
                className={styles.hubGhostButton}
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setValue(user.username || "");
                }}
              >
                {tr(locale).common.cancel}
              </button>
              <button className={styles.hubPrimaryButton} type="button" disabled={saving} onClick={() => void save()}>
                {saving ? t.usernameSaving : t.usernameSave}
              </button>
            </div>
          </div>
        ) : (
          <div className={`${styles.hubFieldValue} ${popover.fieldValue}`}>
            <b dir="ltr">{user.username || user.phoneMasked}</b>
            <button
              className={styles.hubEditButton}
              type="button"
              onClick={() => {
                setValue(user.username || "");
                setEditing(true);
              }}
            >
              <Pencil size={13} aria-hidden="true" />
              {t.usernameEdit}
            </button>
          </div>
        )}
        {error ? <small id="hub-username-hint" className={styles.hubFieldError} role="alert">{error}</small> : <small id="hub-username-hint" className={styles.hubFieldHint}>{t.usernameHint}</small>}
      </div>

      <div className={`${styles.hubField} ${popover.field}`}>
        <span className={styles.hubFieldLabel}>
          <Smartphone size={13} aria-hidden="true" />
          {t.phoneLabel}
        </span>
        <b dir="ltr">{user.phoneMasked}</b>
      </div>

      <div className={`${styles.hubField} ${popover.field}`}>
        <span className={styles.hubFieldLabel}>{t.emailLabel}</span>
        {user.email ? <b dir="ltr">{user.email}</b> : <small className={styles.hubFieldHint}>{t.emailEmpty}</small>}
      </div>

      <button className={styles.hubSignOut} type="button" onClick={onLogout}>
        <LogOut size={15} aria-hidden="true" />
        {t.signOut}
      </button>
    </div>
  );
}

function SubscriptionPanel({
  locale,
  user,
  usage,
  onNavigate,
}: {
  locale: Locale;
  user: HubUser | null;
  usage: HubUsage | null;
  onNavigate: () => void;
}) {
  const t = tr(locale).hub;
  if (!user) return null;
  const threeHours = usage?.text.find((item) => item.window === "3 hours") || usage?.text[0];
  const weekly = usage?.text.find((item) => item.window === "week") || usage?.text[1];

  const meter = (item: { used: number; limit: number; usedPercent: number; resetAt?: string } | undefined, label: string) =>
    item ? (
      <QuotaBar
        key={label}
        value={item.usedPercent}
        label={label}
        hint={fill(t.quotaOf, { used: fmtNum(locale, item.used), limit: fmtNum(locale, item.limit) })}
      />
    ) : null;

  return (
    <div className={styles.hubSubscription}>
      <div className={styles.hubPlanRow}>
        <div className={styles.hubPlanMeta}>
          <small>{t.currentPlan}</small>
          <PlanBadge plan={user.plan} />
        </div>
      </div>
      <div className={styles.hubQuotaList}>
        {meter(threeHours, t.quota3h)}
        {meter(weekly, t.quotaWeek)}
        {usage && meter(usage.image, t.quotaImage)}
      </div>
      <Link className={styles.hubPrimaryLink} href="/plans" onClick={onNavigate}>
        {t.viewPlans}
        <ArrowUpLeft size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}

function navigateRadioGroup(event: ReactKeyboardEvent<HTMLElement>) {
  if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])'));
  if (!options.length) return;
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const rtl = window.getComputedStyle(event.currentTarget).direction === "rtl";
  const forwards = event.key === "ArrowDown" || event.key === (rtl ? "ArrowLeft" : "ArrowRight");
  const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
    : (index + (forwards ? 1 : -1) + options.length) % options.length;
  options[next].focus();
  options[next].click();
}

function AppearancePanel({
  locale,
  onPrefsChange,
}: {
  locale: Locale;
  onPrefsChange: (prefs: { sendOnEnter?: boolean; showSuggestions?: boolean }) => void;
}) {
  const t = tr(locale).hub;
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    queueMicrotask(() => {
      const choice = readPreference("portal-theme-choice");
      setTheme(choice === "light" || choice === "dark" || choice === "system" ? choice : readPreference("portal-theme") === "light" ? "light" : "dark");
      setDensity(readPreference("portal-density") === "compact" ? "compact" : "comfortable");
      setReduceMotion(readPreference("portal-reduce-motion") === "true");
      setSendOnEnter(readPreference("portal-send-enter") !== "false");
      setShowSuggestions(readPreference("portal-show-suggestions") !== "false");
    });
  }, []);

  const applyTheme = (choice: "dark" | "light" | "system") => {
    setTheme(choice);
    const resolved =
      choice === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : choice;
    document.documentElement.dataset.theme = resolved;
    const choiceSaved = writePreference("portal-theme-choice", choice);
    const themeSaved = writePreference("portal-theme", resolved);
    if (choiceSaved && themeSaved) notifyPreferenceChange();
  };

  const applyDensity = (value: "comfortable" | "compact") => {
    setDensity(value);
    document.documentElement.dataset.density = value;
    if (writePreference("portal-density", value)) notifyPreferenceChange();
  };

  const applyMotion = (value: boolean) => {
    setReduceMotion(value);
    document.documentElement.dataset.motion = value ? "reduced" : "full";
    if (writePreference("portal-reduce-motion", String(value))) notifyPreferenceChange();
  };

  const toggleEnter = (value: boolean) => {
    setSendOnEnter(value);
    if (writePreference("portal-send-enter", String(value))) notifyPreferenceChange();
    onPrefsChange({ sendOnEnter: value });
  };

  const toggleSuggestions = (value: boolean) => {
    setShowSuggestions(value);
    if (writePreference("portal-show-suggestions", String(value))) notifyPreferenceChange();
    onPrefsChange({ showSuggestions: value });
  };

  return (
    <div className={styles.hubAppearance}>
      <section className={styles.hubSettingGroup}>
        <b>{t.themeLabel}</b>
        <div className={styles.hubSeg} role="radiogroup" onKeyDown={navigateRadioGroup} aria-label={t.themeLabel}>
          <button
            type="button"
            role="radio"
            aria-checked={theme === "dark"}
            tabIndex={theme === "dark" ? 0 : -1}
            className={theme === "dark" ? styles.hubSegActive : ""}
            onClick={() => applyTheme("dark")}
          >
            <Moon size={15} aria-hidden="true" />
            {t.themeDark}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === "light"}
            tabIndex={theme === "light" ? 0 : -1}
            className={theme === "light" ? styles.hubSegActive : ""}
            onClick={() => applyTheme("light")}
          >
            <Sun size={15} aria-hidden="true" />
            {t.themeLight}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === "system"}
            tabIndex={theme === "system" ? 0 : -1}
            className={theme === "system" ? styles.hubSegActive : ""}
            onClick={() => applyTheme("system")}
          >
            <Sparkles size={15} aria-hidden="true" />
            {t.themeSystem}
          </button>
        </div>
      </section>

      <section className={styles.hubSettingGroup}>
        <b>{t.densityLabel}</b>
        <div className={styles.hubSeg} role="radiogroup" onKeyDown={navigateRadioGroup} aria-label={t.densityLabel}>
          <button
            type="button"
            role="radio"
            aria-checked={density === "comfortable"}
            tabIndex={density === "comfortable" ? 0 : -1}
            className={density === "comfortable" ? styles.hubSegActive : ""}
            onClick={() => applyDensity("comfortable")}
          >
            {t.densityComfortable}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === "compact"}
            tabIndex={density === "compact" ? 0 : -1}
            className={density === "compact" ? styles.hubSegActive : ""}
            onClick={() => applyDensity("compact")}
          >
            {t.densityCompact}
          </button>
        </div>
      </section>

      <section className={styles.hubSettingGroup}>
        <label className={styles.hubSwitchRow}>
          <span>
            <b>{t.reduceMotion}</b>
          </span>
          <input type="checkbox" checked={reduceMotion} onChange={(event) => applyMotion(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        <label className={styles.hubSwitchRow}>
          <span>
            <b>{t.sendEnter}</b>
          </span>
          <input type="checkbox" checked={sendOnEnter} onChange={(event) => toggleEnter(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        <label className={styles.hubSwitchRow}>
          <span>
            <b>{t.showSuggestions}</b>
          </span>
          <input type="checkbox" checked={showSuggestions} onChange={(event) => toggleSuggestions(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
      </section>
    </div>
  );
}

function LanguagePanel({
  locale,
  onLocaleChange,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const t = tr(locale).hub;
  return (
    <div className={styles.hubLanguage}>
      <div className={styles.hubLangGrid} role="radiogroup" onKeyDown={navigateRadioGroup} aria-label={t.languageLabel}>
        {(Object.keys(localeMeta) as Locale[]).map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={item === locale}
            tabIndex={item === locale ? 0 : -1}
            lang={item}
            className={`${styles.hubLangOption} ${item === locale ? styles.hubLangActive : ""}`}
            onClick={() => onLocaleChange(item)}
          >
            <span className={styles.hubLangNative}>{localeMeta[item].label}</span>
            <span className={styles.hubLangCode} dir="ltr">
              {item}
            </span>
            {item === locale && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <small className={styles.hubFieldHint}>{t.languageHint}</small>
    </div>
  );
}

function MorePanel({
  locale,
  role,
  onNavigate,
}: {
  locale: Locale;
  role?: string;
  onNavigate: () => void;
}) {
  const t = tr(locale).hub;
  const links = [
    { href: "/settings", label: t.moreSettingsPage, icon: Settings2 },
    { href: "/models", label: t.moreModels, icon: Layers3 },
    { href: "/plans", label: t.morePlans, icon: WalletCards },
    { href: "/studio", label: t.moreStudio, icon: ImageIcon },
    ...(role === "admin" ? [{ href: "/admin", label: t.moreAdmin, icon: ShieldCheck }] : []),
  ];
  return (
    <div className={styles.hubMore}>
      {links.map(({ href, label, icon: Icon }) => (
        <Link className={styles.hubMoreItem} key={href} href={href} onClick={onNavigate}>
          <span className={`${styles.hubItemIcon} ${popover.itemIcon}`}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <b>{label}</b>
          <ArrowUpLeft size={15} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
