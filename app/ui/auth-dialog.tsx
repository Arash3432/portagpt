"use client";

import { Eye, EyeOff, KeyRound, Mail, ShieldCheck, Smartphone, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "./ui-feedback";

export type AuthSessionUser = { id: string; phoneMasked: string; email?: string; plan: string; username?: string; displayName?: string; role?: string };
type Locale = "fa" | "en" | "ar" | "zh";
type Mode = "login" | "register" | "otp";
type Message = { text: string; tone: "error" | "info" } | null;

const copy: Record<Locale, Record<string, string>> = {
  fa: {
    login: "ورود", register: "ساخت حساب", loginTitle: "خوش اومدی", registerTitle: "حسابت را بساز",
    loginDesc: "شماره موبایل و رمز عبورت را وارد کن.", registerDesc: "شماره، ایمیل و یک رمز خوب؛ همین سه مورد برای شروع کافی است.",
    phone: "شماره موبایل", email: "ایمیل", password: "رمز عبور", confirm: "تکرار رمز عبور",
    phonePlaceholder: "09xxxxxxxxx", emailPlaceholder: "name@example.com", passwordPlaceholder: "حداقل ۱۰ نویسه",
    loginAction: "ورود", registerAction: "ساخت حساب", working: "یک لحظه…",
    noAccount: "حساب نداری؟", hasAccount: "قبلاً ثبت‌نام کردی؟", create: "ثبت‌نام", enter: "وارد شو",
    otpOption: "ورود با کد یک‌بارمصرف", otpTitle: "کد ورود را وارد کن", otpDesc: "کدی که برای شماره‌ات فرستادیم شش رقم دارد.",
    sendOtp: "ارسال کد", otp: "کد ۶ رقمی", verifyOtp: "تأیید و ورود", backPassword: "ورود با رمز عبور",
    smsFallback: "ارسال کد ممکن نبود؛ با رمز عبور وارد شو.", smsReady: "ورود با کد فعال است",
    passwordReady: "", policy: "حداقل ۱۰ نویسه، شامل حرف و عدد",
    weak: "ضعیف", fair: "قابل‌قبول", strong: "قوی", mismatch: "رمز عبور و تکرار آن یکسان نیستند.",
    terms: "با ساخت حساب، قوانین استفاده و حریم خصوصی را می‌پذیری.", generic: "عملیات انجام نشد؛ دوباره امتحان کن.",
    otpSent: "کد ورود ارسال شد و ۵ دقیقه اعتبار دارد.", close: "بستن", showPassword: "نمایش رمز عبور", hidePassword: "پنهان کردن رمز عبور",
  },
  en: {
    login: "Sign in", register: "Create account", loginTitle: "Welcome back", registerTitle: "Create your Portal AI account",
    loginDesc: "Enter your mobile number and password.", registerDesc: "A mobile number, an email, and a good password are all you need.",
    phone: "Mobile number", email: "Email", password: "Password", confirm: "Confirm password",
    phonePlaceholder: "09xxxxxxxxx", emailPlaceholder: "name@example.com", passwordPlaceholder: "At least 10 characters",
    loginAction: "Sign in", registerAction: "Create account", working: "One moment…",
    noAccount: "New here?", hasAccount: "Already registered?", create: "Create account", enter: "Sign in",
    otpOption: "Use an SMS code", otpTitle: "Sign in with a one-time code", otpDesc: "This option is shown only while the SMS service is available.",
    sendOtp: "Send code", otp: "6-digit code", verifyOtp: "Verify and sign in", backPassword: "Use password",
    smsFallback: "SMS is unavailable; password sign-in remains active.", smsReady: "Optional SMS sign-in is available",
    passwordReady: "Password sign-in works without SMS", policy: "10+ characters with at least one letter and number",
    weak: "Weak", fair: "Acceptable", strong: "Strong", mismatch: "The passwords do not match.",
    terms: "By creating an account, you accept the terms and privacy policy.", generic: "The request failed. Please try again.",
    otpSent: "The code was sent and expires in 5 minutes.", close: "Close", showPassword: "Show password", hidePassword: "Hide password",
  },
  ar: {
    login: "دخول", register: "إنشاء حساب", loginTitle: "مرحباً بعودتك", registerTitle: "أنشئ حساب Portal AI",
    loginDesc: "أدخل رقم الهاتف وكلمة المرور.", registerDesc: "رقم هاتف وبريد وكلمة مرور جيدة؛ هذا كل ما تحتاجه.",
    phone: "رقم الهاتف", email: "البريد الإلكتروني", password: "كلمة المرور", confirm: "تأكيد كلمة المرور",
    phonePlaceholder: "09xxxxxxxxx", emailPlaceholder: "name@example.com", passwordPlaceholder: "10 أحرف على الأقل",
    loginAction: "دخول", registerAction: "إنشاء الحساب", working: "لحظة واحدة…",
    noAccount: "ليس لديك حساب؟", hasAccount: "لديك حساب؟", create: "أنشئ حساباً", enter: "ادخل",
    otpOption: "الدخول برمز SMS", otpTitle: "الدخول برمز لمرة واحدة", otpDesc: "يظهر هذا الخيار فقط عند توفر خدمة الرسائل.",
    sendOtp: "إرسال الرمز", otp: "رمز من 6 أرقام", verifyOtp: "تأكيد ودخول", backPassword: "استخدام كلمة المرور",
    smsFallback: "الرسائل غير متاحة؛ الدخول بكلمة المرور يعمل.", smsReady: "الدخول الاختياري بالرسائل متاح",
    passwordReady: "الدخول لا يعتمد على الرسائل", policy: "10 أحرف على الأقل مع حرف ورقم",
    weak: "ضعيفة", fair: "مقبولة", strong: "قوية", mismatch: "كلمتا المرور غير متطابقتين.",
    terms: "بإنشاء الحساب توافق على الشروط وسياسة الخصوصية.", generic: "تعذر إتمام الطلب. حاول مرة أخرى.",
    otpSent: "تم إرسال الرمز وصلاحيته 5 دقائق.", close: "إغلاق", showPassword: "إظهار كلمة المرور", hidePassword: "إخفاء كلمة المرور",
  },
  zh: {
    login: "登录", register: "创建账户", loginTitle: "欢迎回来", registerTitle: "创建 Portal AI 账户",
    loginDesc: "输入手机号和密码。", registerDesc: "手机号、邮箱和一个好密码，就可以开始。",
    phone: "手机号", email: "电子邮箱", password: "密码", confirm: "确认密码",
    phonePlaceholder: "09xxxxxxxxx", emailPlaceholder: "name@example.com", passwordPlaceholder: "至少 10 个字符",
    loginAction: "登录", registerAction: "创建账户", working: "请稍候…",
    noAccount: "还没有账户？", hasAccount: "已有账户？", create: "创建账户", enter: "登录",
    otpOption: "使用短信验证码", otpTitle: "使用一次性验证码登录", otpDesc: "仅在短信服务可用时显示此方式。",
    sendOtp: "发送验证码", otp: "6 位验证码", verifyOtp: "验证并登录", backPassword: "使用密码",
    smsFallback: "短信暂不可用，密码登录仍可使用。", smsReady: "可选短信登录已启用",
    passwordReady: "密码登录不依赖短信", policy: "至少 10 个字符，包含字母和数字",
    weak: "弱", fair: "可接受", strong: "强", mismatch: "两次输入的密码不一致。",
    terms: "创建账户即表示你接受服务条款和隐私政策。", generic: "操作失败，请重试。",
    otpSent: "验证码已发送，5 分钟内有效。", close: "关闭", showPassword: "显示密码", hidePassword: "隐藏密码",
  },
};

const errorCopy: Record<Locale, Record<string, string>> = {
  fa: { INVALID_CREDENTIALS: "شماره موبایل یا رمز عبور درست نیست.", ACCOUNT_EXISTS: "این شماره یا ایمیل قابل ثبت نیست؛ اگر حساب داری وارد شو.", INVALID_PHONE: "شماره موبایل ایران را درست وارد کن.", INVALID_EMAIL: "ایمیل را درست وارد کن.", PASSWORD_TOO_SHORT: "رمز عبور باید حداقل ۱۰ نویسه داشته باشد.", PASSWORD_TOO_LONG: "رمز عبور بیش از حد طولانی است.", PASSWORD_NEEDS_LETTER_AND_NUMBER: "رمز عبور باید حداقل یک حرف و یک عدد داشته باشد.", PASSWORD_TOO_COMMON: "این رمز خیلی قابل‌حدس است؛ رمز دیگری انتخاب کن.", PASSWORD_MISMATCH: "رمز عبور و تکرار آن یکسان نیستند.", LOGIN_RATE_LIMITED: "تلاش‌های زیادی انجام شده؛ ۱۵ دقیقه بعد امتحان کن.", REGISTRATION_RATE_LIMITED: "درخواست‌های زیادی ثبت شده؛ بعداً امتحان کن.", REGISTRATION_RESTRICTED: "ثبت این شماره از شبکه فعلی مجاز نیست.", ADMIN_PASSWORD_REQUIRED: "برای حساب مدیر از تب ورود و رمز مدیر استفاده کن." },
  en: { INVALID_CREDENTIALS: "The mobile number or password is incorrect.", ACCOUNT_EXISTS: "This mobile number or email cannot be registered. Try signing in.", INVALID_PHONE: "Enter a valid Iranian mobile number.", INVALID_EMAIL: "Enter a valid email address.", PASSWORD_TOO_SHORT: "Use at least 10 characters.", PASSWORD_TOO_LONG: "The password is too long.", PASSWORD_NEEDS_LETTER_AND_NUMBER: "Include at least one letter and one number.", PASSWORD_TOO_COMMON: "Choose a less predictable password.", PASSWORD_MISMATCH: "The passwords do not match.", LOGIN_RATE_LIMITED: "Too many attempts. Try again in 15 minutes.", REGISTRATION_RATE_LIMITED: "Too many registration attempts. Try again later.", REGISTRATION_RESTRICTED: "This number cannot be registered from the current network.", ADMIN_PASSWORD_REQUIRED: "Use the sign-in tab and the administrator password for this account." },
  ar: { INVALID_CREDENTIALS: "رقم الهاتف أو كلمة المرور غير صحيحة.", ACCOUNT_EXISTS: "لا يمكن تسجيل هذا الرقم أو البريد. حاول الدخول.", INVALID_PHONE: "أدخل رقم هاتف إيراني صالحاً.", INVALID_EMAIL: "أدخل بريداً إلكترونياً صالحاً.", PASSWORD_TOO_SHORT: "استخدم 10 أحرف على الأقل.", PASSWORD_TOO_LONG: "كلمة المرور طويلة جداً.", PASSWORD_NEEDS_LETTER_AND_NUMBER: "أضف حرفاً ورقماً على الأقل.", PASSWORD_TOO_COMMON: "اختر كلمة مرور أصعب.", PASSWORD_MISMATCH: "كلمتا المرور غير متطابقتين.", LOGIN_RATE_LIMITED: "محاولات كثيرة. حاول بعد 15 دقيقة.", REGISTRATION_RATE_LIMITED: "محاولات تسجيل كثيرة. حاول لاحقاً.", REGISTRATION_RESTRICTED: "لا يمكن تسجيل هذا الرقم من الشبكة الحالية.", ADMIN_PASSWORD_REQUIRED: "استخدم تب تسجيل الدخول وكلمة مرور المدير لهذا الحساب." },
  zh: { INVALID_CREDENTIALS: "手机号或密码不正确。", ACCOUNT_EXISTS: "该手机号或邮箱无法注册，请尝试登录。", INVALID_PHONE: "请输入有效的伊朗手机号。", INVALID_EMAIL: "请输入有效的邮箱。", PASSWORD_TOO_SHORT: "密码至少需要 10 个字符。", PASSWORD_TOO_LONG: "密码过长。", PASSWORD_NEEDS_LETTER_AND_NUMBER: "密码至少包含一个字母和一个数字。", PASSWORD_TOO_COMMON: "请选择更难猜的密码。", PASSWORD_MISMATCH: "两次输入的密码不一致。", LOGIN_RATE_LIMITED: "尝试次数过多，请 15 分钟后重试。", REGISTRATION_RATE_LIMITED: "注册请求过多，请稍后重试。", REGISTRATION_RESTRICTED: "当前网络无法注册此号码。", ADMIN_PASSWORD_REQUIRED: "请使用登录页和管理员密码访问此账户。" },
};

function PasswordInput({ label, value, onChange, autoComplete, placeholder, showLabel, hideLabel, invalid = false, describedBy }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; placeholder: string; showLabel: string; hideLabel: string; invalid?: boolean; describedBy?: string }) {
  const [visible, setVisible] = useState(false);
  return <label><span>{label}</span><div className={`auth-input-wrap ${invalid ? "has-error" : ""}`}><KeyRound size={16} /><input dir="ltr" type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} minLength={10} maxLength={128} required aria-invalid={invalid || undefined} aria-describedby={describedBy} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? hideLabel : showLabel} title={visible ? hideLabel : showLabel}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>;
}

export function AuthDialog({ locale, initialMode = "login", allowRegistration = true, onClose, onAuthenticated }: { locale: Locale; initialMode?: "login" | "register"; allowRegistration?: boolean; onClose: () => void; onAuthenticated: (user: AuthSessionUser, csrfToken: string) => void }) {
  const t = copy[locale];
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/capabilities", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setSmsAvailable(Boolean(data?.smsAvailable)))
      .catch(() => setSmsAvailable(false));
    return () => controller.abort();
  }, []);

  useDialogFocus(true, cardRef, onClose);

  const strength = useMemo(() => {
    if (!password) return 0;
    let score = password.length >= 10 ? 1 : 0;
    if (password.length >= 14) score += 1;
    if (/\p{L}/u.test(password) && /\p{N}/u.test(password)) score += 1;
    if (/[^\p{L}\p{N}\s]/u.test(password)) score += 1;
    return Math.min(3, score);
  }, [password]);

  const switchMode = (next: Mode) => { setMode(next); setMessage(null); setOtpSent(false); setOtp(""); };
  const responseMessage = (body: { code?: string; error?: string }) => body.code === "LOGIN_RATE_LIMITED" ? (locale === "fa" ? "تلاش‌های ورود بیش از حد بود؛ ۵ دقیقه بعد دوباره امتحان کن." : locale === "en" ? "Too many attempts. Try again in 5 minutes." : errorCopy[locale][body.code] || body.error || t.generic) : errorCopy[locale][body.code || ""] || body.error || t.generic;

  const finish = (body: { user?: AuthSessionUser; csrfToken?: string }) => {
    if (!body.user || !body.csrfToken) throw new Error(t.generic);
    onAuthenticated(body.user, body.csrfToken);
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "register" && password !== confirmation) return setMessage({ text: t.mismatch, tone: "error" });
    setPending(true); setMessage(null);
    try {
      const endpoint = mode === "register" ? "/api/auth/password/register" : "/api/auth/password/login";
      const payload = mode === "register" ? { phone, email, password, passwordConfirmation: confirmation } : { phone, password };
      const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage({ text: responseMessage(body), tone: "error" });
      finish(body);
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : t.generic, tone: "error" }); }
    finally { setPending(false); }
  };

  const submitOtp = async (event: FormEvent) => {
    event.preventDefault(); setPending(true); setMessage(null);
    try {
      const endpoint = otpSent ? "/api/auth/otp/verify" : "/api/auth/otp/request";
      const payload = otpSent ? { phone, code: otp } : { phone };
      const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (body.code === "PASSWORD_FALLBACK_REQUIRED") {
        setSmsAvailable(false); switchMode("login"); setMessage({ text: t.smsFallback, tone: "info" }); return;
      }
      if (!response.ok) return setMessage({ text: responseMessage(body), tone: "error" });
      if (!otpSent) { setOtpSent(true); setMessage({ text: body.devCode ? `Development code: ${body.devCode}` : t.otpSent, tone: "info" }); return; }
      finish(body);
    } catch { setSmsAvailable(false); switchMode("login"); setMessage({ text: t.smsFallback, tone: "info" }); }
    finally { setPending(false); }
  };

  const direction = locale === "fa" || locale === "ar" ? "rtl" : "ltr";
  const confirmationInvalid = Boolean(confirmation) && password !== confirmation;
  return <div className="auth-overlay" dir={direction} role="dialog" aria-modal="true" aria-labelledby="portal-auth-title">
    <button type="button" className="auth-scrim" onClick={onClose} aria-label={t.close} />
    <div className="auth-card auth-card--credentials" ref={cardRef}>
      <button type="button" className="auth-close" onClick={onClose} aria-label={t.close}><X size={18} /></button>
      <div className="auth-logo"><Image unoptimized src="/portal-ai-logo.png" width={80} height={80} alt="Portal AI" /></div>
      {mode !== "otp" && allowRegistration && <div className="auth-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-active" : ""} onClick={() => switchMode("login")}>{t.login}</button><button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-active" : ""} onClick={() => switchMode("register")}>{t.register}</button></div>}
      <h2 id="portal-auth-title">{mode === "login" ? t.loginTitle : mode === "register" ? t.registerTitle : t.otpTitle}</h2>
      <p>{mode === "login" ? t.loginDesc : mode === "register" ? t.registerDesc : t.otpDesc}</p>
      {mode !== "otp" ? <form onSubmit={submitPassword}>
        <label><span>{t.phone}</span><div className="auth-input-wrap"><Smartphone size={16} /><input autoFocus data-dialog-autofocus dir="ltr" inputMode="tel" autoComplete="username" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phonePlaceholder} minLength={10} maxLength={30} required /></div></label>
        {mode === "register" && <label><span>{t.email}</span><div className="auth-input-wrap"><Mail size={16} /><input dir="ltr" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.emailPlaceholder} maxLength={254} required /></div></label>}
        <PasswordInput label={t.password} value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={t.passwordPlaceholder} showLabel={t.showPassword} hideLabel={t.hidePassword} describedBy={mode === "register" ? "portal-password-status" : undefined} />
        {mode === "register" && <><PasswordInput label={t.confirm} value={confirmation} onChange={setConfirmation} autoComplete="new-password" placeholder={t.passwordPlaceholder} showLabel={t.showPassword} hideLabel={t.hidePassword} invalid={confirmationInvalid} describedBy="portal-password-status" /><div id="portal-password-status" className={`password-strength is-${strength} ${confirmationInvalid ? "has-error" : ""}`} aria-live="polite"><span aria-hidden="true"><i /><i /><i /></span><small>{confirmationInvalid ? t.mismatch : `${t.policy} · ${strength <= 1 ? t.weak : strength === 2 ? t.fair : t.strong}`}</small></div></>}
        <button className="button button--primary auth-submit" type="submit" disabled={pending}>{pending ? t.working : mode === "register" ? t.registerAction : t.loginAction}</button>
      </form> : <form onSubmit={submitOtp}>
        {!otpSent ? <label><span>{t.phone}</span><div className="auth-input-wrap"><Smartphone size={16} /><input autoFocus data-dialog-autofocus dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phonePlaceholder} minLength={10} maxLength={30} required /></div></label> : <label><span>{t.otp}</span><div className="auth-input-wrap"><KeyRound size={16} /><input autoFocus data-dialog-autofocus className="auth-otp-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="------" pattern="[0-9]{6}" required /></div></label>}
        <button className="button button--primary auth-submit" type="submit" disabled={pending}>{pending ? t.working : otpSent ? t.verifyOtp : t.sendOtp}</button>
      </form>}

      {message && <div className={`auth-message is-${message.tone}`} aria-live="polite">{message.text}</div>}
      {allowRegistration ? <div className="auth-switch-row">{mode === "login" ? <>{t.noAccount} <button type="button" onClick={() => switchMode("register")}>{t.create}</button></> : mode === "register" ? <>{t.hasAccount} <button type="button" onClick={() => switchMode("login")}>{t.enter}</button></> : <button type="button" onClick={() => switchMode("login")}>{t.backPassword}</button>}</div> : mode === "otp" && <div className="auth-switch-row"><button type="button" onClick={() => switchMode("login")}>{t.backPassword}</button></div>}
      {allowRegistration && smsAvailable && mode !== "otp" && <button type="button" className="auth-otp-option" onClick={() => switchMode("otp")}><Smartphone size={14} />{t.otpOption}</button>}
      {mode === "register" && <small><ShieldCheck size={13} />{t.terms}</small>}
    </div>
  </div>;
}
