"use client";

import {
  ArrowUpLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Languages,
  LogIn,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AuthDialog } from "./auth-dialog";
import { PublicLocale, PublicSessionContext, PublicShell } from "./public-shell";
import { ToastNotice, type UiNotice, useDialogFocus } from "./ui-feedback";
import { tr } from "./i18n";
import styles from "./pages-refined.module.css";

type Model = { id: string; name: string; type: "text" | "image"; available?: boolean };
type ThemeChoice = "dark" | "light" | "system";
function readPreference(key: string) { try { return window.localStorage.getItem(key); } catch { return null; } }
const detailCopy = {
  fa: { show: "نمایش رمزها", hide: "پنهان کردن رمزها", saving: "در حال حذف…", sections: "بخش‌های تنظیمات", saved: "تغییرات ظاهری خودکار اعمال می‌شوند", storage: "مرورگر اجازه ذخیره تنظیمات روی این دستگاه را نمی‌دهد.", modelsLoading: "در حال دریافت مدل‌ها…", modelsFailed: "فهرست مدل‌ها در دسترس نیست", unsaved: "تغییرات گفتگو هنوز ذخیره نشده است." },
  en: { show: "Show passwords", hide: "Hide passwords", saving: "Deleting…", sections: "Settings sections", saved: "Appearance changes apply immediately", storage: "Your browser does not allow settings to be saved on this device.", modelsLoading: "Loading models…", modelsFailed: "Model list unavailable", unsaved: "Chat preferences have unsaved changes." },
  ar: { show: "إظهار كلمات المرور", hide: "إخفاء كلمات المرور", saving: "جارٍ الحذف…", sections: "أقسام الإعدادات", saved: "تُطبّق تغييرات المظهر فوراً", storage: "لا يسمح المتصفح بحفظ الإعدادات على هذا الجهاز.", modelsLoading: "جارٍ تحميل النماذج…", modelsFailed: "قائمة النماذج غير متاحة", unsaved: "تغييرات تفضيلات المحادثة لم تُحفظ بعد." },
  zh: { show: "显示密码", hide: "隐藏密码", saving: "正在删除…", sections: "设置部分", saved: "外观更改立即生效", storage: "浏览器不允许在此设备上保存设置。", modelsLoading: "正在加载模型…", modelsFailed: "模型列表不可用", unsaved: "对话偏好有未保存的更改。" },
};

export function SettingsCenter() {
  return <PublicShell>{(locale, session) => <SettingsContent locale={locale} session={session} />}</PublicShell>;
}

function SettingsContent({ locale, session }: { locale: PublicLocale; session: PublicSessionContext }) {
  const router = useRouter();
  const t = tr(locale);
  const d = detailCopy[locale];
  const user = session.user;
  const csrf = session.csrfToken;
  const [authOpen, setAuthOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModel, setDefaultModel] = useState("sirius");
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [modelOwner, setModelOwner] = useState("");
  const [modelsRetry, setModelsRetry] = useState(0);
  const [savedChat, setSavedChat] = useState({ sendOnEnter: true, showSuggestions: true, defaultModel: "sirius" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const securityLock = useRef(false);
  const securityVersion = useRef(0);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<UiNotice>(null);
  const pushNotice = (text: string, tone: "success" | "error" | "info" = "info") => setNotice({ text, tone });
  const closeNotice = useCallback(() => setNotice(null), []);
  const closeDeleteDialog = useCallback(() => { if (!deleting) setDeleteOpen(false); }, [deleting]);
  useDialogFocus(deleteOpen, deleteDialogRef, closeDeleteDialog);

  useEffect(() => {
    const themeChoice = readPreference("portal-theme-choice") || readPreference("portal-theme");
    const savedTheme: ThemeChoice = themeChoice === "light" || themeChoice === "system" ? themeChoice : "dark";
    const savedDensity = readPreference("portal-density") === "compact" ? "compact" : "comfortable";
    const savedMotion = readPreference("portal-reduce-motion") === "true";
    const savedEnter = readPreference("portal-send-enter") !== "false";
    const savedSuggestions = readPreference("portal-show-suggestions") !== "false";
    const savedModel = readPreference("portal-default-model") || "sirius";
    queueMicrotask(() => { setTheme(savedTheme); setDensity(savedDensity); setReduceMotion(savedMotion); setSendOnEnter(savedEnter); setShowSuggestions(savedSuggestions); setDefaultModel(savedModel); setSavedChat({ sendOnEnter: savedEnter, showSuggestions: savedSuggestions, defaultModel: savedModel }); });
    const syncAppearance = () => {
      const choice = readPreference("portal-theme-choice") || readPreference("portal-theme") || document.documentElement.dataset.theme;
      setTheme(choice === "light" || choice === "system" ? choice : "dark");
      setDensity((readPreference("portal-density") || document.documentElement.dataset.density) === "compact" ? "compact" : "comfortable");
      setReduceMotion(readPreference("portal-reduce-motion") === "true" || (readPreference("portal-reduce-motion") === null && document.documentElement.dataset.motion === "reduced"));
    };
    window.addEventListener("storage", syncAppearance);
    window.addEventListener("portal-preferences-changed", syncAppearance);
    return () => { window.removeEventListener("storage", syncAppearance); window.removeEventListener("portal-preferences-changed", syncAppearance); };
  }, []);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    const closeTimer = window.setTimeout(() => setAuthOpen(false), 0);
    return () => window.clearTimeout(closeTimer);
  }, [session.status]);

  const owner = `${user?.id || "guest"}:${user?.plan || "free"}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("models_unavailable");
      const body = await response.json();
      if (!Array.isArray(body.models)) throw new Error("models_invalid");
      if (controller.signal.aborted) return;
      setModels(body.models.filter((model: Model) => model.type === "text" && model.available));
      setModelStatus("ready"); setModelOwner(owner);
    }).catch(() => { if (!controller.signal.aborted) { setModelStatus("error"); setModelOwner(owner); } });
    return () => controller.abort();
  }, [owner, modelsRetry]);

  useEffect(() => {
    securityVersion.current += 1;
    const timer = window.setTimeout(() => { setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setShowPasswords(false); setDeleteText(""); setDeleteOpen(false); }, 0);
    return () => { window.clearTimeout(timer); securityVersion.current += 1; };
  }, [user?.id]);

  const storePreferences = (values: Record<string, string>) => {
    try {
      Object.entries(values).forEach(([key, value]) => window.localStorage.setItem(key, value));
      window.dispatchEvent(new Event("portal-preferences-changed"));
      return true;
    } catch { pushNotice(d.storage, "error"); return false; }
  };
  const applyTheme = (choice: ThemeChoice) => {
    setTheme(choice);
    const resolved = choice === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = resolved;
    storePreferences({ "portal-theme-choice": choice, "portal-theme": resolved });
  };
  const applyDensity = (value: "comfortable" | "compact") => { setDensity(value); document.documentElement.dataset.density = value; storePreferences({ "portal-density": value }); };
  const applyMotion = (value: boolean) => { setReduceMotion(value); document.documentElement.dataset.motion = value ? "reduced" : "full"; storePreferences({ "portal-reduce-motion": String(value) }); };
  const saveChatPreferences = () => {
    const values: Record<string, string> = { "portal-send-enter": String(sendOnEnter), "portal-show-suggestions": String(showSuggestions) };
    if (models.some((model) => model.id === defaultModel) && modelOwner === owner) values["portal-default-model"] = defaultModel;
    if (storePreferences(values)) { setSavedChat({ sendOnEnter, showSuggestions, defaultModel }); pushNotice(t.settings.chatPrefsSaved, "success"); }
  };
  const resetLocal = () => {
    const resetModel = models.find((model) => model.id === "sirius")?.id || models[0]?.id || "sirius";
    setTheme("dark"); setDensity("comfortable"); setReduceMotion(false); setSendOnEnter(true); setShowSuggestions(true); setDefaultModel(resetModel);
    document.documentElement.dataset.theme = "dark"; document.documentElement.dataset.density = "comfortable"; document.documentElement.dataset.motion = "full";
    if (storePreferences({ "portal-theme-choice": "dark", "portal-theme": "dark", "portal-density": "comfortable", "portal-reduce-motion": "false", "portal-send-enter": "true", "portal-show-suggestions": "true", "portal-default-model": resetModel })) {
      setSavedChat({ sendOnEnter: true, showSuggestions: true, defaultModel: resetModel }); pushNotice(t.settings.resetDone, "success");
    }
  };
  const chatDirty = savedChat.sendOnEnter !== sendOnEnter || savedChat.showSuggestions !== showSuggestions || savedChat.defaultModel !== defaultModel;
  const loadingModels = modelOwner !== owner || modelStatus === "loading";
  const availableModels = modelOwner === owner && modelStatus === "ready" ? models : [];
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (securityLock.current || !csrf || !user) return;
    if (newPassword !== confirmation) return pushNotice(t.settings.passwordMismatch, "error");
    securityLock.current = true;
    const version = securityVersion.current;
    setSavingPassword(true);
    try {
      const response = await fetch("/api/account/password", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ currentPassword, newPassword, confirmation }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t.settings.passwordFailed);
      if (version !== securityVersion.current) return;
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setShowPasswords(false); pushNotice(t.settings.passwordChanged, "success");
    } catch (error) { if (version === securityVersion.current) pushNotice(error instanceof Error ? error.message : t.settings.passwordFailed, "error"); }
    finally { securityLock.current = false; setSavingPassword(false); }
  };
  const deleteAccount = async () => {
    if (securityLock.current || deleteText !== "DELETE" || !csrf || !user) return;
    securityLock.current = true; setDeleting(true);
    const version = securityVersion.current;
    try {
      const response = await fetch("/api/account/delete", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ confirmation: deleteText }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t.settings.deleteFailed);
      if (version !== securityVersion.current) return;
      session.clear();
      router.push("/");
    } catch (error) { if (version === securityVersion.current) pushNotice(error instanceof Error ? error.message : t.settings.deleteFailed, "error"); }
    finally { securityLock.current = false; setDeleting(false); }
  };

  return <>
    <section className={`${styles.refined} ${styles.settingsPage} settings-page public-container`}>
      <header className="settings-heading" data-reveal><div><span><Settings2 size={17} /> {t.settings.eyebrow}</span><h1>{t.settings.title}</h1><p>{t.settings.intro}</p></div><button type="button" onClick={resetLocal}><RotateCcw size={17} />{t.settings.resetDevice}</button></header>
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsNav} aria-label={d.sections}><a href="#settings-appearance"><Palette size={17} />{t.settings.appearanceTitle}</a><a href="#settings-chat"><Sparkles size={17} />{t.settings.chatPrefsTitle}</a><a href="#settings-language"><Languages size={17} />{t.settings.languageTitle}</a>{user && <a href="#settings-security"><ShieldCheck size={17} />{t.settings.passwordTitle}</a>}<small><Check size={14} />{d.saved}</small></nav>
        <div className={styles.settingsContent}>
      <section id="settings-appearance" className="settings-section" data-reveal><header><span><Palette size={20} /></span><div><h2>{t.settings.appearanceTitle}</h2><p>{t.settings.appearanceDesc}</p></div></header><div className="theme-choices" role="group" aria-label={t.settings.appearanceTitle}><button type="button" aria-pressed={theme === "dark"} className={theme === "dark" ? "is-active" : ""} onClick={() => applyTheme("dark")}><span className="theme-preview is-dark"><i /><i /></span><b><Moon size={17} />{t.settings.themeDark}</b>{theme === "dark" && <Check size={16} />}</button><button type="button" aria-pressed={theme === "light"} className={theme === "light" ? "is-active" : ""} onClick={() => applyTheme("light")}><span className="theme-preview is-light"><i /><i /></span><b><Sun size={17} />{t.settings.themeLight}</b>{theme === "light" && <Check size={16} />}</button><button type="button" aria-pressed={theme === "system"} className={theme === "system" ? "is-active" : ""} onClick={() => applyTheme("system")}><span className="theme-preview is-system"><i /><i /></span><b><Sparkles size={17} />{t.settings.themeSystem}</b>{theme === "system" && <Check size={16} />}</button></div><div className="setting-rows"><label><span><b>{t.settings.densityLabel}</b><small>{t.settings.densityHint}</small></span><select value={density} onChange={(event) => applyDensity(event.target.value as "comfortable" | "compact")}><option value="comfortable">{t.settings.densityComfortable}</option><option value="compact">{t.settings.densityCompact}</option></select></label><label><span><b>{t.settings.reduceMotionLabel}</b><small>{t.settings.reduceMotionHint}</small></span><input type="checkbox" checked={reduceMotion} onChange={(event) => applyMotion(event.target.checked)} /></label></div></section>

      <section id="settings-chat" className="settings-section" data-reveal><header><span><Sparkles size={20} /></span><div><h2>{t.settings.chatPrefsTitle}</h2><p>{t.settings.chatPrefsDesc}</p></div></header><div className="setting-rows"><label><span><b>{t.settings.defaultModelLabel}</b><small>{t.settings.defaultModelHint}</small></span><select value={availableModels.some((model) => model.id === defaultModel) ? defaultModel : ""} disabled={loadingModels || !availableModels.length} onChange={(event) => setDefaultModel(event.target.value)}><option value="" disabled>{loadingModels ? d.modelsLoading : t.settings.defaultModelLabel}</option>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label><span><b>{t.settings.sendEnterLabel}</b><small>{t.settings.sendEnterHint}</small></span><input type="checkbox" checked={sendOnEnter} onChange={(event) => setSendOnEnter(event.target.checked)} /></label><label><span><b>{t.settings.suggestionsLabel}</b><small>{t.settings.suggestionsHint}</small></span><input type="checkbox" checked={showSuggestions} onChange={(event) => setShowSuggestions(event.target.checked)} /></label></div><div className={styles.settingsSaveRow}><button className="settings-save" type="button" disabled={!chatDirty} onClick={saveChatPreferences}><Save size={17} />{t.settings.saveChatPrefs}</button>{chatDirty && <small role="status">{d.unsaved}</small>}</div>{modelStatus === "error" && !loadingModels && <div className={styles.inlineError} role="alert"><p>{d.modelsFailed}</p><button type="button" onClick={() => { setModelStatus("loading"); setModelsRetry((value) => value + 1); }}>{t.common.retry}</button></div>}</section>

      <section id="settings-language" className="settings-section" data-reveal><header><span><Languages size={20} /></span><div><h2>{t.settings.languageTitle}</h2><p>{t.settings.languageDesc}</p></div></header><div className="language-summary"><span>{locale === "fa" ? "فارسی" : locale === "en" ? "English" : locale === "ar" ? "العربية" : "中文"}</span><small>{t.settings.languageAutoHint}</small></div></section>

      {session.status === "checking" ? <section className="settings-signin" data-reveal><span><UserRound size={24} /></span><div><h2>{t.settings.sessionCheckingTitle}</h2><p>{t.settings.sessionCheckingDesc}</p></div></section> : session.status === "unavailable" ? <section className="settings-signin" data-reveal><span><ShieldCheck size={24} /></span><div><h2>{t.settings.sessionUnavailableTitle}</h2><p>{t.settings.sessionUnavailableDesc}</p></div><button type="button" className="public-primary" onClick={() => void session.refresh()}><LogIn size={17} />{t.common.retry}</button></section> : !user ? <section className="settings-signin" data-reveal><span><UserRound size={24} /></span><div><h2>{t.settings.guestTitle}</h2><p>{t.settings.guestDesc}</p></div><button type="button" className="public-primary" onClick={() => setAuthOpen(true)}><LogIn size={17} />{t.common.signIn}</button></section> : <>
        <section id="settings-security" className="settings-section" data-reveal><header><span><KeyRound size={20} /></span><div><h2>{t.settings.passwordTitle}</h2><p>{t.settings.passwordDesc}</p></div></header><form className="password-settings" onSubmit={changePassword}><label><span>{t.settings.currentPassword}</span><div><KeyRound size={17} /><input type={showPasswords ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /><button type="button" aria-label={showPasswords ? d.hide : d.show} aria-pressed={showPasswords} onClick={() => setShowPasswords((value) => !value)}>{showPasswords ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><label><span>{t.settings.newPassword}</span><div><ShieldCheck size={17} /><input type={showPasswords ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} required /></div></label><label><span>{t.settings.confirmPassword}</span><div><ShieldCheck size={17} /><input type={showPasswords ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={10} required /></div></label><small>{t.settings.passwordRule}</small><button className="settings-save" type="submit" disabled={savingPassword || deleting || !csrf}>{savingPassword ? t.settings.changingPassword : t.settings.changePassword}<ArrowUpLeft size={17} /></button></form></section>
        <section className="settings-danger" data-reveal><span><Trash2 size={21} /></span><div><h2>{t.settings.dangerTitle}</h2><p>{t.settings.dangerDesc}</p></div><button type="button" disabled={savingPassword || deleting || !csrf} onClick={() => { setDeleteText(""); setDeleteOpen(true); }}>{t.settings.dangerButton}</button></section>
      </>}
        </div>
      </div>
    </section>

    {authOpen && <AuthDialog locale={locale} onClose={() => setAuthOpen(false)} onAuthenticated={(nextUser, token) => { session.adopt(nextUser, token); setAuthOpen(false); void session.refresh(); }} />}
    {deleteOpen && <div className={`${styles.refined} delete-overlay`} role="dialog" aria-busy={deleting} aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><button type="button" className="ui-confirm-scrim" disabled={deleting} onClick={closeDeleteDialog} aria-label={t.common.cancel} /><div className="delete-card" ref={deleteDialogRef}><button type="button" disabled={deleting} onClick={closeDeleteDialog} aria-label={t.common.close}><X size={18} /></button><span><Trash2 size={24} /></span><h2 id="delete-title">{t.settings.deleteDialogTitle}</h2><p id="delete-description">{t.settings.deleteDialogBodyPrefix} <b>DELETE</b> {t.settings.deleteDialogBodySuffix}</p><input data-dialog-autofocus disabled={deleting} dir="ltr" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="DELETE" autoComplete="off" aria-label={t.settings.deleteConfirmAria} /><div><button type="button" className="public-secondary" disabled={deleting} onClick={closeDeleteDialog}>{t.common.cancel}</button><button type="button" className="ui-danger-button" disabled={deleteText !== "DELETE" || deleting || !csrf} onClick={() => void deleteAccount()}>{deleting ? d.saving : t.settings.deleteConfirm}</button></div></div></div>}
    <ToastNotice notice={notice} onClose={closeNotice} locale={locale} />
  </>;
}
