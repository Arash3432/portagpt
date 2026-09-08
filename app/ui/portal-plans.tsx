"use client";

import {
  ArrowUpLeft,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Image as ImageIcon,
  MessageCircleMore,
  Sparkles,
  WandSparkles,
  Zap,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { type PublicLocale, type PublicSessionContext, PublicShell } from "./public-shell";
import styles from "./pages-refined.module.css";

type PlanCode = "free" | "starter" | "plus" | "pro" | "ultra";
type PaidPlanCode = Exclude<PlanCode, "free">;
type ApiPlan = { code: PlanCode; title: string; monthly_price_toman: number; text_credit_3h:number; text_credit_weekly:number; image_credit_limit: number; image_reset_interval: string; file_limit_per_message: number; checkoutAvailable: boolean };

function parseSelectedPaidPlan(value: string | null): PaidPlanCode | null {
  return value === "starter" || value === "plus" || value === "pro" || value === "ultra" ? value : null;
}

const copy: Record<PublicLocale, {
  eyebrow: string; title: string; intro: string; monthly: string; toman: string; free: string; choose: string; current: string; workspace: string; recommended: string; selectedPlanTitle: string; selectedPlanBody: string;
  imageCredit: string; files: string; reset: Record<string, string>; planText: Record<PlanCode, [string, string]>; features: Record<PlanCode, string[]>;
  compareTitle: string; compareIntro: string; table: string[]; unlimitedHistory: string; models: Record<PlanCode, string>; support: Record<PlanCode, string>;
  usageTitle: string; usageBody: string; usageCards: Array<[string, string]>; faqTitle: string; faqs: Array<[string, string]>; finalTitle: string; finalBody: string;
}> = {
  fa: {
    eyebrow: "اشتراک‌های Portal AI", title: "به اندازه‌ای که می‌سازی، فضا داشته باش.", intro: "از استفاده سبک روزانه تا پروژه‌های سنگین متن و تصویر؛ پلنی را انتخاب کن که با ریتم واقعی کارت هماهنگ باشد.", monthly: "ماهانه", toman: "تومان", free: "رایگان", choose: "انتخاب اشتراک", current: "شروع رایگان", workspace: "ادامه در فضای کار", recommended: "انتخاب متعادل", selectedPlanTitle: "پلن {plan} انتخاب شده است", selectedPlanBody: "این فقط انتخاب شماست؛ هنوز پرداختی انجام نشده و اشتراکی فعال نشده است.",
    imageCredit: "اعتبار تصویر", files: "فایل در هر پیام", reset: { day: "هر روز", month: "هر ماه", "3 hours": "هر ۳ ساعت",week:"هفتگی" },
    planText: { free: ["برای آشنایی و استفاده سبک", "سؤال‌های روزمره را بپرس، Sirius را امتحان کن و بدون هزینه فضای کار را بشناس."], starter: ["برای شروع جدی‌تر", "مناسب دانش‌آموز، تولید محتوای سبک و کارهایی که هر روز چند بار به کمک نیاز دارند."], plus: ["برای ریتم ثابت روزانه", "همه مدل‌ها، فایل‌های بیشتر و فضای کافی برای کسی که Portal AI بخشی از روز کاری اوست."], pro: ["برای پروژه‌های حرفه‌ای", "ظرفیت بالاتر پیام و تصویر برای توسعه‌دهنده‌ها و سازنده‌های محتوا."], ultra: ["برای استفاده سنگین", "بیشترین ظرفیت متن، تصویر و فایل برای تیم کوچک یا کاربری که توقف برایش معنی ندارد."] },
    features: { free: ["۲ انتخاب متنی اقتصادی", "تاریخچه کامل گفتگو", "۱ اعتبار تصویر در هفته"], starter: ["۵ مدل متنی منتخب", "۱۵ اعتبار تصویر در هفته", "تا ۱۰ فایل در هر پیام"], plus: ["دسترسی به همه مدل‌ها", "۱۰۰ اعتبار تصویر در هفته", "اولویت بهتر در پردازش"], pro: ["همه مدل‌های متن، کد و تصویر", "۴۵۰ اعتبار تصویر در هفته", "ظرفیت مناسب پروژه حرفه‌ای"], ultra: ["همه مدل‌های فعال", "۹۵۰ اعتبار تصویر در هفته", "تا ۱۵ فایل در هر پیام"] },
    compareTitle: "همه تفاوت‌ها، در یک نگاه.", compareIntro: "قبل از انتخاب دقیقاً ببین هر اشتراک برای چه نوع کاری ساخته شده است.", table: ["مدل‌ها", "تصویر", "فایل در پیام", "تاریخچه", "پشتیبانی"], unlimitedHistory: "کامل", models: { free: "۲ مدل متنی", starter: "۵ مدل متنی", plus: "همه مدل‌ها", pro: "همه مدل‌ها", ultra: "همه مدل‌ها" }, support: { free: "معمولی", starter: "معمولی", plus: "سریع‌تر", pro: "اولویت‌دار", ultra: "ویژه" },
    usageTitle: "سهمیه‌ای که قابل فهم می‌ماند.", usageBody: "مصرف پیام در دو بازهٔ سه‌ساعته و هفتگی و مصرف تصویر فقط هفتگی نمایش داده می‌شود.", usageCards: [["پیام", "دو سقف سه‌ساعته و هفتگی هم‌زمان از هزینه ناگهانی جلوگیری می‌کنند."], ["تصویر", "اعتبار تصویر مستقل و هفتگی است؛ هر مدل می‌تواند یک یا چند اعتبار مصرف کند."], ["فایل", "مجموع فایل‌های هر پیام حداکثر ۵۰ مگابایت است."]],
    faqTitle: "سؤال‌های قبل از انتخاب", faqs: [["آیا می‌توانم رایگان شروع کنم؟", "بله. حساب رایگان برای آشنایی با محیط، گفتگوهای روزمره و یک اعتبار تصویر هفتگی مناسب است."], ["هر درخواست چند اعتبار مصرف می‌کند؟", "مقدار پایه یک اعتبار است، اما مدل‌های سنگین‌تر می‌توانند بیشتر مصرف کنند؛ مقدار دقیق قبل از ارسال دیده می‌شود."], ["اگر سهمیه تمام شود چه می‌شود؟", "هزینه اضافه‌ای ایجاد نمی‌شود. تا شروع بازه بعدی صبر می‌کنی یا اشتراک بالاتری انتخاب می‌کنی."], ["آیا اشتراک خودکار تمدید می‌شود؟", "تمدید خودکار فقط وقتی فعال می‌شود که خودت هنگام پرداخت آن را انتخاب کنی؛ وضعیت همیشه در صفحه حساب دیده می‌شود."]],
    finalTitle: "از Free شروع کن و ریتم مناسب خودت را پیدا کن.", finalBody: "ساخت حساب کمتر از یک دقیقه زمان می‌برد و بعداً هر زمان خواستی می‌توانی اشتراک را تغییر بدهی.",
  },
  en: {
    eyebrow: "Portal AI plans", title: "Make room for the way you create.", intro: "From light everyday use to demanding text and image projects, choose a plan that matches your actual pace.", monthly: "monthly", toman: "Toman", free: "Free", choose: "Choose plan", current: "Start free", workspace: "Continue to workspace", recommended: "Balanced choice", selectedPlanTitle: "{plan} is selected", selectedPlanBody: "This records your selection only. No payment has been made and no plan has been activated.", imageCredit: "image credits", files: "files per message", reset: { day: "daily", month: "monthly", "3 hours": "every 3 hours",week:"weekly" },
    planText: { free: ["A simple way to begin", "Try Sirius, ask everyday questions, and get to know the workspace at no cost."], starter: ["A more serious start", "For students, light content work, and a few helpful sessions every day."], plus: ["A steady daily rhythm", "Every model, more files, and room for Portal AI to become part of your routine."], pro: ["Professional projects", "Higher message and image capacity for developers and creators."], ultra: ["Heavy, continuous use", "The highest text, image, and file capacity for demanding individual work."] },
    features: { free: ["2 economical text choices", "Full conversation history", "1 weekly image credit"], starter: ["5 selected text models", "15 weekly image credits", "Up to 10 files per message"], plus: ["Every available model", "100 weekly image credits", "Improved processing priority"], pro: ["Every text, code, and image model", "450 weekly image credits", "Capacity for professional projects"], ultra: ["Every active model", "950 weekly image credits", "Up to 15 files per message"] },
    compareTitle: "Every difference, at a glance.", compareIntro: "See exactly what each plan was built for before you decide.", table: ["Models", "Images", "Files", "History", "Support"], unlimitedHistory: "Full", models: { free: "2 text models", starter: "5 text models", plus: "All models", pro: "All models", ultra: "All models" }, support: { free: "Standard", starter: "Standard", plus: "Faster", pro: "Priority", ultra: "Dedicated" },
    usageTitle: "Usage that stays understandable.", usageBody: "Messages have 3-hour and weekly windows; image credits refresh weekly and remain separate.", usageCards: [["Messages", "The 3-hour and weekly limits apply together."], ["Images", "Weekly image credits are separate; each model may use one or more."], ["Files", "Files in one message can total up to 50 MB."]],
    faqTitle: "Questions before choosing", faqs: [["Can I start for free?", "Yes. Free is enough to explore the workspace, chat, and use one weekly image credit."], ["What is an image credit?", "Each generation uses credits. Professional models or heavier settings may need more than one."], ["What happens when I reach a limit?", "There are no surprise charges. Wait for the next window or move to a larger plan."], ["Does my plan renew automatically?", "Only if you explicitly choose automatic renewal during payment; the status is always visible in your account."]], finalTitle: "Start with Free and find your pace.", finalBody: "Creating an account takes less than a minute, and you can change plans later.",
  },
  ar: {
    eyebrow: "اشتراكات Portal AI", title: "مساحة تناسب مقدار ما تصنع.", intro: "من الاستخدام اليومي الخفيف إلى مشاريع النص والصورة الثقيلة؛ اختر ما يناسب وتيرة عملك.", monthly: "شهرياً", toman: "تومان", free: "مجاني", choose: "اختيار الاشتراك", current: "ابدأ مجاناً", workspace: "متابعة إلى مساحة العمل", recommended: "الخيار المتوازن", selectedPlanTitle: "تم اختيار خطة {plan}", selectedPlanBody: "هذا تسجيل لاختيارك فقط؛ لم يتم الدفع ولم يتم تفعيل أي اشتراك.", imageCredit: "رصيد صورة", files: "ملفات في الرسالة", reset: { day: "كل يوم", month: "كل شهر", "3 hours": "كل 3 ساعات",week:"أسبوعياً" },
    planText: { free: ["للبداية الخفيفة", "جرّب Sirius وتعرّف على مساحة العمل دون تكلفة."], starter: ["لبداية أكثر جدية", "للطلاب وصناعة المحتوى الخفيف والاستخدام اليومي."], plus: ["لإيقاع يومي ثابت", "نماذج وملفات أكثر ومساحة كافية لعملك اليومي."], pro: ["للمشاريع الاحترافية", "نماذج أعمق وشحن سريع للصور للمطورين والمبدعين."], ultra: ["للاستخدام المكثف", "أعلى سعة للنص والصورة والملفات."] },
    features: { free: ["خياران اقتصاديان للنص", "سجل محادثات كامل", "رصيد صورة أسبوعي واحد"], starter: ["5 نماذج نص مختارة", "15 رصيد صورة أسبوعياً", "حتى 10 ملفات في الرسالة"], plus: ["كل النماذج المتاحة", "100 رصيد صورة أسبوعياً", "أولوية معالجة أفضل"], pro: ["كل نماذج النص والبرمجة والصورة", "450 رصيد صورة أسبوعياً", "سعة للمشاريع الاحترافية"], ultra: ["كل النماذج النشطة", "950 رصيد صورة أسبوعياً", "حتى 15 ملفاً في الرسالة"] },
    compareTitle: "كل الفروقات في نظرة واحدة.", compareIntro: "اعرف ما صُمم له كل اشتراك قبل الاختيار.", table: ["النماذج", "الصور", "الملفات", "السجل", "الدعم"], unlimitedHistory: "كامل", models: { free: "نموذجان للنص", starter: "5 نماذج للنص", plus: "كل النماذج", pro: "كل النماذج", ultra: "كل النماذج" }, support: { free: "عادي", starter: "عادي", plus: "أسرع", pro: "أولوية", ultra: "خاص" },
    usageTitle: "استخدام سهل الفهم.", usageBody: "للرسائل حد كل 3 ساعات وحد أسبوعي، وللصور رصيد أسبوعي مستقل.", usageCards: [["الرسائل", "يعمل الحد كل 3 ساعات والحد الأسبوعي معاً."], ["الصور", "الرصيد أسبوعي ومستقل وقد يستهلك النموذج أكثر من رصيد."], ["الملفات", "الحد الإجمالي للملفات في الرسالة 50 ميغابايت."]],
    faqTitle: "أسئلة قبل الاختيار", faqs: [["هل أستطيع البدء مجاناً؟", "نعم، الخطة المجانية مناسبة للتجربة والمحادثة ورصيد صورة واحد أسبوعياً."], ["ما هو رصيد الصورة؟", "كل عملية توليد تستهلك رصيداً، وقد تحتاج النماذج الاحترافية إلى أكثر من رصيد."], ["ماذا يحدث عند نفاد الحد؟", "لا توجد رسوم مفاجئة؛ انتظر الفترة التالية أو اختر خطة أكبر."], ["هل يتجدد الاشتراك تلقائياً؟", "فقط إذا اخترت ذلك بنفسك أثناء الدفع."]], finalTitle: "ابدأ مجاناً واعثر على وتيرتك.", finalBody: "إنشاء الحساب يستغرق أقل من دقيقة ويمكن تغيير الاشتراك لاحقاً.",
  },
  zh: {
    eyebrow: "Portal AI 套餐", title: "为你的创作节奏留出空间。", intro: "从轻度日常使用到高强度文本与图像项目，选择符合真实节奏的套餐。", monthly: "每月", toman: "托曼", free: "免费", choose: "选择套餐", current: "免费开始", workspace: "继续工作区", recommended: "均衡之选", selectedPlanTitle: "已选择 {plan} 套餐", selectedPlanBody: "这只会记录你的选择；尚未付款，也没有激活套餐。", imageCredit: "图像积分", files: "每条消息文件数", reset: { day: "每天", month: "每月", "3 hours": "每 3 小时",week:"每周" },
    planText: { free: ["轻松开始", "免费试用 Sirius，处理日常问题并熟悉工作空间。"], starter: ["更认真地开始", "适合学生、轻量内容创作和每日多次使用。"], plus: ["稳定的日常节奏", "更多模型与文件空间，让 Portal AI 成为日常工具。"], pro: ["专业项目", "更深入的模型与快速图像额度刷新。"], ultra: ["持续高强度使用", "最高的文本、图像与文件容量。"] },
    features: { free: ["2 个经济文本选择", "完整对话历史", "每周 1 图像积分"], starter: ["5 个精选文本模型", "每周 15 图像积分", "每条消息最多 10 个文件"], plus: ["全部可用模型", "每周 100 图像积分", "更高处理优先级"], pro: ["全部文本、代码和图像模型", "每周 450 图像积分", "专业项目容量"], ultra: ["全部可用模型", "每周 950 图像积分", "每条消息最多 15 个文件"] },
    compareTitle: "所有差异，一目了然。", compareIntro: "选择前，清楚了解每个套餐适合什么。", table: ["模型", "图像", "文件", "历史", "支持"], unlimitedHistory: "完整", models: { free: "2 个文本模型", starter: "5 个文本模型", plus: "全部模型", pro: "全部模型", ultra: "全部模型" }, support: { free: "标准", starter: "标准", plus: "更快", pro: "优先", ultra: "专属" },
    usageTitle: "始终易懂的使用额度。", usageBody: "消息有 3 小时和每周限制；图像积分独立按周刷新。", usageCards: [["消息", "3 小时与每周限制同时生效。"], ["图像", "每周积分独立，模型可能消耗一个或多个积分。"], ["文件", "单条消息中的文件总计最多 50 MB。"]],
    faqTitle: "选择前的问题", faqs: [["可以免费开始吗？", "可以。免费套餐足以体验工作空间、对话并使用每周一个图像积分。"], ["什么是图像积分？", "每次生成都会使用积分，专业模型可能需要多个积分。"], ["达到限制后会怎样？", "不会产生意外费用。等待下一个周期或升级套餐即可。"], ["套餐会自动续费吗？", "仅当你在付款时主动选择自动续费。"]], finalTitle: "从免费开始，找到自己的节奏。", finalBody: "创建账户不到一分钟，以后可随时更改套餐。",
  },
};

export function PortalPlans() {
  return <PublicShell active="plans">{(locale, session) => <Suspense fallback={<PlansContent locale={locale} session={session} selectedPlan={null} />}><PlansContentWithSelection locale={locale} session={session} /></Suspense>}</PublicShell>;
}

function PlansContentWithSelection({ locale, session }: { locale: PublicLocale; session: PublicSessionContext }) {
  const searchParams = useSearchParams();
  return <PlansContent locale={locale} session={session} selectedPlan={parseSelectedPaidPlan(searchParams.get("selected"))} />;
}

const detailCopy = {
  fa: { loading: "در حال دریافت قیمت و سهمیه‌ها…", failed: "قیمت و مشخصات اشتراک‌ها دریافت نشد.", retry: "دوباره تلاش کن", empty: "فعلاً اشتراکی برای نمایش وجود ندارد.", compare: "مقایسه دقیق سهمیه‌ها", active: "اشتراک فعلی شما", selection: "انتخاب و بررسی", payment: "انتخاب این پلن، پرداخت یا فعال‌سازی انجام نمی‌دهد.", modelList: "بررسی مدل‌های هر اشتراک", price: "قیمت ماهانه (تومان)", imageCredits: "اعتبار تصویر / هفته", renewalQuestion: "چطور اشتراک فعال می‌شود؟", renewalAnswer: "انتخاب پلن در این صفحه تنها انتخاب شما را ثبت می‌کند؛ پرداخت و فعال‌سازی انجام نمی‌شود. اشتراک فعلی را در صفحه حساب ببینید.", finalBody: "از محیط گفتگو شروع کن و سهمیه مصرف‌شده را در حساب خودت ببین." },
  en: { loading: "Loading current prices and allowances…", failed: "We could not load plan prices and details.", retry: "Try again", empty: "No plans are listed right now.", compare: "Compare every allowance", active: "Your current plan", selection: "Select and review", payment: "Selecting this plan does not take payment or activate it.", modelList: "Explore models by plan", price: "Monthly price (Toman)", imageCredits: "image credits / week", renewalQuestion: "How is a plan activated?", renewalAnswer: "Choosing a plan here records your selection only. It does not take payment or activate a subscription. Your current plan is shown in your account.", finalBody: "Start in the workspace and track your usage in your account." },
  ar: { loading: "جارٍ تحميل الأسعار والحصص الحالية…", failed: "تعذّر تحميل أسعار الخطط وتفاصيلها.", retry: "حاول مجدداً", empty: "لا توجد خطط معروضة حالياً.", compare: "قارن جميع الحصص", active: "خطتك الحالية", selection: "اختيار ومراجعة", payment: "اختيار هذه الخطة لا ينفذ الدفع أو التفعيل.", modelList: "استكشف النماذج حسب الخطة", price: "السعر الشهري (تومان)", imageCredits: "رصيد صور / أسبوع", renewalQuestion: "كيف تُفعّل الخطة؟", renewalAnswer: "يسجل اختيار الخطة هنا اختيارك فقط، ولا ينفّذ دفعاً أو تفعيل اشتراك. راجع خطتك الحالية في حسابك.", finalBody: "ابدأ في مساحة العمل وتابع استخدامك في حسابك." },
  zh: { loading: "正在加载最新价格和额度…", failed: "无法加载套餐价格和详情。", retry: "重试", empty: "目前没有列出的套餐。", compare: "比较全部额度", active: "你的当前套餐", selection: "选择并查看", payment: "选择此套餐不会付款或激活订阅。", modelList: "按套餐查看模型", price: "月费（托曼）", imageCredits: "图像积分 / 周", renewalQuestion: "如何激活套餐？", renewalAnswer: "在此页面选择套餐只会记录你的选择，不会付款或激活订阅。请在账户中查看当前套餐。", finalBody: "从工作区开始，在账户中查看使用情况。" },
};

function PlansContent({ locale, session, selectedPlan }: { locale: PublicLocale; session: PublicSessionContext; selectedPlan: PaidPlanCode | null }) {
  const t = copy[locale];
  const d = detailCopy[locale];
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/plans", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("plans_unavailable");
      const data = await response.json();
      if (!Array.isArray(data.plans)) throw new Error("plans_invalid");
      if (controller.signal.aborted) return;
      setPlans(data.plans);
      setStatus("ready");
    }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [retry]);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const labels = {
    threeHour: locale === "fa" ? "پیام / ۳ ساعت" : locale === "ar" ? "رسالة / 3 ساعات" : locale === "zh" ? "消息 / 3 小时" : "messages / 3h",
    weeklyText: locale === "fa" ? "پیام / هفته" : locale === "ar" ? "رسالة / أسبوع" : locale === "zh" ? "消息 / 周" : "messages / week",
  };
  const selectedPlanData = selectedPlan ? plans.find((plan) => plan.code === selectedPlan) : null;
  const reload = () => { setStatus("loading"); setRetry((value) => value + 1); };

  return <div className={`${styles.refined} ${styles.plansPage}`}>
    <section className={`${styles.pageHero} public-container`}><span className={styles.eyebrow}><span /><WalletCards size={16} />{t.eyebrow}</span><h1>{t.title}</h1><p>{t.intro}</p><div className={styles.heroMeta}><a href="#plan-comparison">{d.compare}<ChevronDown size={16} /></a><Link href="/models">{d.modelList}<ArrowUpLeft size={16} /></Link></div></section>
    {selectedPlanData && <aside className={`${styles.selectionNote} public-container`} role="status"><Check size={20} /><div><strong>{t.selectedPlanTitle.replace("{plan}", selectedPlanData.title)}</strong><p>{t.selectedPlanBody}</p></div></aside>}
    {status === "loading" ? <div className={`${styles.skeletonGrid} public-container`} role="status" aria-label={d.loading}>{[0, 1, 2].map((item) => <div className={styles.skeletonCard} key={item}><i /><i /><i /></div>)}</div> : status === "error" || !plans.length ? <div className={`${styles.emptyState} public-container`} role={status === "error" ? "alert" : "status"}><RefreshCw size={28} /><h2>{status === "error" ? d.failed : d.empty}</h2><button type="button" onClick={reload}>{d.retry}</button></div> : <>
      <section className={`${styles.planGrid} public-container`}>{plans.map((plan) => {
        const text = t.planText[plan.code] || [plan.title, ""];
        const isCurrent = session.isAuthenticated && session.user?.plan === plan.code;
        const isPaidPlan = plan.code !== "free";
        const href = isCurrent ? "/account" : session.isAuthenticated ? (isPaidPlan ? `/plans?selected=${encodeURIComponent(plan.code)}` : session.workspaceHref) : session.status === "anonymous" ? `/app?auth=register&plan=${encodeURIComponent(plan.code)}` : session.workspaceHref;
        const ctaLabel = isCurrent ? d.active : isPaidPlan ? d.selection : session.isAuthenticated ? t.workspace : t.current;
        return <article className={styles.planCard} data-featured={plan.code === "plus"} data-selected={selectedPlan === plan.code || isCurrent} key={plan.code}>
          <header><div><span>{plan.title}</span>{isCurrent ? <span className={styles.currentBadge}><Check size={13} />{d.active}</span> : plan.code === "plus" ? <span className={styles.currentBadge}><Sparkles size={13} />{t.recommended}</span> : null}</div><h2>{text[0]}</h2></header>
          <div className={styles.planPrice}><strong>{plan.monthly_price_toman ? number(plan.monthly_price_toman) : t.free}</strong>{plan.monthly_price_toman > 0 && <span>{t.toman}<small>/ {t.monthly}</small></span>}</div>
          <dl className={styles.planQuotas}>
            <div><dt><MessageCircleMore size={16} />{labels.threeHour}</dt><dd>{number(plan.text_credit_3h)}</dd></div>
            <div><dt><Clock3 size={16} />{labels.weeklyText}</dt><dd>{number(plan.text_credit_weekly)}</dd></div>
            <div><dt><ImageIcon size={16} />{d.imageCredits}</dt><dd>{number(plan.image_credit_limit)}</dd></div>
            <div><dt><FileText size={16} />{t.files}</dt><dd>{number(plan.file_limit_per_message)}</dd></div>
          </dl>
          <Link className={plan.code === "plus" ? "public-primary" : "public-secondary"} href={href} aria-current={isCurrent ? "true" : undefined}>{ctaLabel}<ArrowUpLeft size={17} /></Link>
          {isPaidPlan && !isCurrent && <small className={styles.paymentNote}>{d.payment}</small>}
        </article>;
      })}</section>
      <section className="plan-compare public-container" id="plan-comparison"><header className={styles.sectionHeading}><span>{t.compareIntro}</span><h2>{t.compareTitle}</h2></header><div className={`${styles.compareTable} compare-wrap`} role="region" aria-label={d.compare} tabIndex={0}><table><caption className={styles.srOnly}>{d.compare}</caption><thead><tr><th scope="col">Portal AI</th>{plans.map((plan) => <th scope="col" key={plan.code}>{plan.title}</th>)}</tr></thead><tbody>{([
        [d.price, "monthly_price_toman"], [labels.threeHour, "text_credit_3h"], [labels.weeklyText, "text_credit_weekly"], [d.imageCredits, "image_credit_limit"], [t.files, "file_limit_per_message"],
      ] as const).map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{plans.map((plan) => <td key={plan.code} data-current={session.user?.plan === plan.code}>{number(plan[key])}</td>)}</tr>)}</tbody></table></div></section>
    </>}
    <section className="plan-usage public-container"><div><span><Clock3 size={21} /></span><h2>{t.usageTitle}</h2><p>{t.usageBody}</p></div><div>{t.usageCards.map(([title, body], index) => <article key={title}><span>{index === 0 ? <MessageCircleMore size={19} /> : index === 1 ? <ImageIcon size={19} /> : <FileText size={19} />}</span><div><b>{title}</b><p>{body}</p></div></article>)}</div></section>
    <section className="plan-faq public-container"><header><span><WandSparkles size={20} /></span><h2>{t.faqTitle}</h2></header><div>{[...t.faqs.slice(1, 3), [d.renewalQuestion, d.renewalAnswer]].map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>
    <section className="home-final public-container"><div><span><Zap size={16} /> Portal AI</span><h2>{t.finalTitle}</h2><p>{d.finalBody}</p></div><Link className="public-primary is-large" href={session.startHref}>{session.isAuthenticated ? t.workspace : t.current}<ArrowUpLeft size={19} /></Link></section>
  </div>;
}
