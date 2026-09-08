"use client";

import { ArrowDown, ArrowUp, ArrowUpLeft, ArrowUpRight, Check, Code2, Download, History, Image as ImageIcon, Layers3, LoaderCircle, MessageCircleMore, Plus, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useRef, useState, useTransition } from "react";
import { type PublicLocale, type PublicSessionContext, PublicShell } from "./public-shell";
import styles from "./portal-landing.module.css";

type Starter = { label: string; prompt: string };
type HomeCopy = {
  eyebrow: string; title: string; accent: string; intro: string;
  modes: [string, string, string]; question: string; placeholders: [string, string, string];
  starters: [Starter[], Starter[], Starter[]]; try: string; continue: string; imageContinue: string;
  opening: string; draftNote: string; workspace: string; seeMore: string; keyboard: string;
  pillars: [string, string, string];
  studioKicker: string; studioTitle: string; studioAccent: string; studioBody: string;
  studioCta: string; studioPrompt: string; studioPromptLabel: string; artworkLabel: string; artworkAlt: string;
  studioNotes: [string, string]; workflowKicker: string; workflowTitle: string; workflowBody: string;
  workflow: Array<{ title: string; text: string; link: string }>;
  finalKicker: string; finalTitle: string; finalBody: string; finalCta: string;
  plans: string; privacy: string; terms: string;
};

const copy: Record<PublicLocale, HomeCopy> = {
  fa: {
    eyebrow: "فضایی برای فکر کردن. ابزاری برای ساختن.", title: "از ذهن تو،", accent: "تا چیزی که می‌سازی.",
    intro: "سؤال‌ها را باز کن، کدها را بهتر کن و به ایده‌ها تصویر بده. همه در یک فضای کار، با ریتم خودت.",
    modes: ["گفتگو", "کدنویسی", "تصویر"], question: "از کجا شروع کنیم؟",
    placeholders: ["یک سؤال، یک ایده، یا کاری که می‌خواهی جلو ببری…", "می‌خواهی چه چیزی بسازی یا کدام مسئله را حل کنی؟", "تصویری که در ذهن داری را توصیف کن…"],
    starters: [
      [{ label: "یک ایده را پرورش بده", prompt: "کمکم کن ایده یک محصول جدید را بررسی کنم. اول درباره مخاطب، مسئله و امکاناتم از من سؤال بپرس." }, { label: "یک تصمیم بهتر", prompt: "کمکم کن برای یک تصمیم مهم، گزینه‌ها و معیارهایم را مرتب کنم. با چند سؤال کوتاه شروع کن." }, { label: "برنامه‌ریزی هفته", prompt: "می‌خواهم برای هفته‌ام یک برنامه واقع‌بینانه داشته باشم. اول درباره اولویت‌ها و زمان در دسترسم سؤال کن." }],
      [{ label: "پیدا کردن باگ", prompt: "می‌خواهم باگ کدم را پیدا کنم. از من کد، پیام خطا و رفتار مورد انتظار را بپرس و بعد مرحله‌به‌مرحله بررسی کن." }, { label: "بازنویسی کد", prompt: "کمکم کن کدم را خواناتر کنم. ابتدا کد و محدودیت‌های پروژه را بپرس و تغییرات پیشنهادی را توضیح بده." }, { label: "از ایده تا ساخت", prompt: "می‌خواهم یک پروژه نرم‌افزاری بسازم. درباره کاربرد، کاربران و تجربه من بپرس تا یک مسیر اجرایی ساده طراحی کنیم." }],
      [{ label: "معماری خیال‌انگیز", prompt: "یک سازه معماری مینیمال با یک درگاه آبی کبالت در چشم‌اندازی آرام، نور طبیعی نرم، بافت سنگی و ترکیب‌بندی سینمایی؛ بدون متن و لوگو." }, { label: "عکس محصول", prompt: "عکس استودیویی یک بطری شیشه‌ای ساده روی سطح سنگی روشن، نور جانبی نرم و سایه طبیعی، ترکیب‌بندی خلوت و حرفه‌ای؛ بدون نوشته و لوگو." }, { label: "پوستر خلاقانه", prompt: "یک پوستر انتزاعی با فرم‌های هندسی آبی و نقره‌ای، فضای خالی زیاد، نور ظریف و حس آینده‌نگر؛ بدون نوشته و لوگو." }],
    ],
    try: "یا از یک ایده شروع کن", continue: "ادامه در گفتگو", imageContinue: "ادامه در استودیو", opening: "در حال باز کردن…",
    draftNote: "متنت در فضای کار باز می‌شود؛ ارسال با تأیید توست.", workspace: "ورود مستقیم به فضای کار", seeMore: "کشف فضای کار", keyboard: "برای ادامه",
    pillars: ["گفتگو و نوشتن", "کدنویسی و حل مسئله", "ساخت و دانلود تصویر"],
    studioKicker: "۰۱ / استودیوی تصویر", studioTitle: "تصورش کن.", studioAccent: "قابش کن.",
    studioBody: "از یک توصیف ساده شروع کن. مدل را انتخاب کن، روند ساخت را ببین و تصویر آماده را با یک کلیک دانلود کن.",
    studioCta: "ایده‌ات را تصویر کن", studioPromptLabel: "یک ایده برای شروع", studioPrompt: "معماری مینیمال، آبی کبالت، نور نرم؛ جایی میان واقعیت و خیال.",
    artworkLabel: "تصویر مفهومی برای الهام", artworkAlt: "درگاه آبی کبالت در میان معماری روشن و مینیمال؛ یک تصویر مفهومی برای الهام",
    studioNotes: ["توصیف تصویر و انتخاب مدل", "دانلود خروجی آماده"],
    workflowKicker: "۰۲ / یک جریان پیوسته", workflowTitle: "کمتر بین ابزارها بگرد.\nبیشتر روی کارت بمان.", workflowBody: "ابزارهای مورد نیازت نزدیک‌اند؛ از اولین سؤال تا برگشتن به کاری که ناتمام مانده.",
    workflow: [
      { title: "با گفت‌وگو، فکر را روشن کن", text: "بنویس، سؤال بپرس و پاسخ را همان‌طور که شکل می‌گیرد دنبال کن. هر وقت لازم بود، توقف کن و مسیر را عوض کن.", link: "شروع یک گفتگو" },
      { title: "ابزار متناسب با کارت را پیدا کن", text: "مدل‌های موجود و قابلیت‌هایشان را ببین و برای نوشتن، کدنویسی یا تصویرسازی انتخاب آگاهانه‌تری داشته باش.", link: "بررسی مدل‌ها" },
      { title: "ادامه دادن، یک قدم فاصله دارد", text: "از تاریخچه به گفتگوهای قبلی برگرد. ایده‌ای که دیروز شروع کردی، نقطه شروع امروز توست.", link: "باز کردن فضای کار" },
    ],
    finalKicker: "ایده بعدی، از اینجا شروع می‌شود", finalTitle: "فضای کار تو.\nبه وسعت ایده‌هایت.", finalBody: "شروع کن و قابلیت‌ها را از نزدیک ببین. برای انتخاب اشتراک، جزئیات و محدودیت‌های هر طرح را مقایسه کن.", finalCta: "بریم سراغ ایده‌ات", plans: "مقایسه اشتراک‌ها", privacy: "حریم خصوصی", terms: "شرایط استفاده",
  },
  en: {
    eyebrow: "Space to think. Tools to create.", title: "From a thought", accent: "to something real.", intro: "Explore a question, work through code, or give an idea an image. One workspace, at your pace.",
    modes: ["Chat", "Code", "Image"], question: "Where shall we begin?", placeholders: ["A question, an idea, or something you want to move forward…", "What would you like to build, understand, or fix?", "Describe the image you have in mind…"],
    starters: [
      [{ label: "Explore an idea", prompt: "Help me explore an idea for a new product. First ask about my audience, the problem, and the resources I have." }, { label: "Think through a decision", prompt: "Help me organize the options and criteria for an important decision. Start with a few short questions." }, { label: "Plan my week", prompt: "Help me make a realistic plan for my week. First ask about my priorities and the time I have available." }],
      [{ label: "Find a bug", prompt: "Help me debug my code. Ask for the code, error message, and expected behavior, then work through it step by step." }, { label: "Refine my code", prompt: "Help me make my code easier to read. First ask for the code and project constraints, then explain your proposed changes." }, { label: "Plan a build", prompt: "I want to build a software project. Ask about its purpose, users, and my experience so we can create a practical plan." }],
      [{ label: "Imagined architecture", prompt: "Minimalist architecture with a cobalt blue portal in a tranquil landscape, soft natural light, stone textures, cinematic composition, no text or logos." }, { label: "Product photography", prompt: "Studio photograph of a simple glass bottle on a pale stone surface, soft side lighting, natural shadow, clean professional composition, no text or logos." }, { label: "Creative poster", prompt: "An abstract poster with blue and silver geometric forms, generous negative space, delicate lighting and a futuristic mood, no text or logos." }],
    ],
    try: "Or start with an idea", continue: "Continue in chat", imageContinue: "Continue in studio", opening: "Opening…", draftNote: "Your draft opens in the workspace. You decide when to send.", workspace: "Go straight to your workspace", seeMore: "Explore the workspace", keyboard: "to continue",
    pillars: ["Conversation & writing", "Code & problem solving", "Create & download images"],
    studioKicker: "01 / Image studio", studioTitle: "Imagine it.", studioAccent: "Give it form.", studioBody: "Start with a description. Choose a model, follow the generation, and download your finished image with a click.", studioCta: "Turn an idea into an image", studioPromptLabel: "An idea to begin with", studioPrompt: "Minimal architecture. Cobalt blue. Soft light. Somewhere between real and imagined.", artworkLabel: "Concept artwork for inspiration", artworkAlt: "A cobalt blue portal set in pale minimalist architecture, a concept artwork for inspiration", studioNotes: ["Describe an image, choose a model", "Download the finished image"],
    workflowKicker: "02 / Stay in your flow", workflowTitle: "Less switching.\nMore making.", workflowBody: "The tools you need, close at hand. From your first question to picking up where you left off.",
    workflow: [
      { title: "Think it through, in conversation", text: "Write, ask, and follow the answer as it takes shape. Pause whenever you need to, and take your thinking in a new direction.", link: "Start a conversation" },
      { title: "Find the right tool for your work", text: "Explore available models and their capabilities to make a considered choice for writing, coding, or image creation.", link: "Explore models" },
      { title: "Pick up where you left off", text: "Return to earlier conversations from your history. Yesterday’s first thought can be today’s starting point.", link: "Open your workspace" },
    ],
    finalKicker: "Your next idea starts here", finalTitle: "Your workspace.\nRoom for your ideas.", finalBody: "Start exploring the tools. When you choose a plan, compare its features and limits to find a fit for your work.", finalCta: "Let’s work on your idea", plans: "Compare plans", privacy: "Privacy", terms: "Terms of use",
  },
  ar: {
    eyebrow: "مساحة للتفكير. أدوات للإبداع.", title: "من فكرة في ذهنك،", accent: "إلى شيء تصنعه.", intro: "استكشف سؤالاً، طوّر الكود، أو امنح فكرة صورة. مساحة عمل واحدة، بإيقاعك أنت.",
    modes: ["محادثة", "برمجة", "صورة"], question: "من أين نبدأ؟", placeholders: ["سؤال، فكرة، أو عمل تريد إنجازه…", "ما الذي تريد بناءه أو فهمه أو إصلاحه؟", "صِف الصورة التي تتخيلها…"],
    starters: [
      [{ label: "طوّر فكرة", prompt: "ساعدني في استكشاف فكرة لمنتج جديد. اسألني أولاً عن الجمهور والمشكلة والموارد المتاحة." }, { label: "فكّر في قرار", prompt: "ساعدني في ترتيب الخيارات والمعايير لاتخاذ قرار مهم. ابدأ ببضعة أسئلة قصيرة." }, { label: "خطّط لأسبوعي", prompt: "ساعدني في إعداد خطة واقعية لأسبوعي. اسألني أولاً عن الأولويات والوقت المتاح." }],
      [{ label: "اكتشف خطأ", prompt: "ساعدني في تصحيح الكود. اطلب الكود ورسالة الخطأ والسلوك المتوقع، ثم راجعه خطوة بخطوة." }, { label: "حسّن الكود", prompt: "ساعدني في جعل الكود أوضح. اطلب الكود وقيود المشروع أولاً ثم اشرح التغييرات المقترحة." }, { label: "خطّط لمشروع", prompt: "أريد بناء مشروع برمجي. اسألني عن الهدف والمستخدمين وخبرتي حتى نضع خطة عملية." }],
      [{ label: "عمارة خيالية", prompt: "عمارة بسيطة مع بوابة زرقاء بلون الكوبالت في منظر هادئ، إضاءة طبيعية ناعمة، ملمس حجري وتكوين سينمائي، دون نصوص أو شعارات." }, { label: "تصوير منتجات", prompt: "صورة استوديو لزجاجة زجاجية بسيطة على سطح حجري فاتح، إضاءة جانبية ناعمة وظل طبيعي وتكوين احترافي هادئ، دون نصوص أو شعارات." }, { label: "ملصق إبداعي", prompt: "ملصق تجريدي بأشكال هندسية زرقاء وفضية، مساحة فارغة واسعة وإضاءة دقيقة وطابع مستقبلي، دون نصوص أو شعارات." }],
    ],
    try: "أو ابدأ بفكرة", continue: "المتابعة في المحادثة", imageContinue: "المتابعة في الاستوديو", opening: "جارٍ الفتح…", draftNote: "تُفتح المسودة في مساحة العمل. أنت تختار وقت الإرسال.", workspace: "إلى مساحة العمل مباشرة", seeMore: "اكتشف مساحة العمل", keyboard: "للمتابعة", pillars: ["محادثة وكتابة", "برمجة وحل المشكلات", "إنشاء الصور وتنزيلها"],
    studioKicker: "٠١ / استوديو الصور", studioTitle: "تخيّلها.", studioAccent: "امنحها صورة.", studioBody: "ابدأ بوصف. اختر النموذج، تابع الإنشاء، ثم نزّل الصورة الجاهزة بنقرة.", studioCta: "حوّل فكرتك إلى صورة", studioPromptLabel: "فكرة للبداية", studioPrompt: "عمارة بسيطة، أزرق كوبالت، ضوء ناعم؛ بين الواقع والخيال.", artworkLabel: "عمل تصوري للإلهام", artworkAlt: "بوابة زرقاء بلون الكوبالت في عمارة فاتحة وبسيطة؛ عمل تصوري للإلهام", studioNotes: ["وصف الصورة واختيار النموذج", "تنزيل الصورة الجاهزة"],
    workflowKicker: "٠٢ / تدفّق متواصل", workflowTitle: "تنقّل أقل.\nإنجاز أكثر.", workflowBody: "الأدوات التي تحتاجها قريبة، من سؤالك الأول إلى استكمال العمل الذي تركته.",
    workflow: [
      { title: "وضّح فكرتك بالمحادثة", text: "اكتب واسأل وتابع الإجابة وهي تتشكّل. توقّف حين تحتاج، وغيّر اتجاه التفكير.", link: "ابدأ محادثة" },
      { title: "اختر أداة تناسب عملك", text: "استكشف النماذج المتاحة وقدراتها لتختار ما يناسب الكتابة أو البرمجة أو إنشاء الصور.", link: "استكشاف النماذج" },
      { title: "أكمل من حيث توقّفت", text: "عُد إلى المحادثات السابقة من السجل. فكرة الأمس قد تكون نقطة انطلاق اليوم.", link: "افتح مساحة العمل" },
    ],
    finalKicker: "فكرتك التالية تبدأ هنا", finalTitle: "مساحة عملك.\nومتّسع لأفكارك.", finalBody: "ابدأ باستكشاف الأدوات. قارن مزايا الاشتراكات وحدودها لاختيار ما يناسب عملك.", finalCta: "لنبدأ بفكرتك", plans: "مقارنة الاشتراكات", privacy: "الخصوصية", terms: "شروط الاستخدام",
  },
  zh: {
    eyebrow: "留出思考的空间，拥有创作的工具。", title: "从脑海中的想法，", accent: "到你亲手创造。", intro: "探索问题、完善代码，让想法变成图像。一个工作空间，按照你的节奏。",
    modes: ["对话", "编程", "图像"], question: "从哪里开始？", placeholders: ["一个问题、一个想法，或你想推进的工作…", "你想构建、理解或修复什么？", "描述你脑海中的图像…"],
    starters: [
      [{ label: "探索想法", prompt: "帮我探索一个新产品想法。请先询问目标用户、要解决的问题和可用资源。" }, { label: "梳理决定", prompt: "帮我整理一项重要决定的选项和判断标准。请从几个简短的问题开始。" }, { label: "规划一周", prompt: "帮我为这周制定一份现实的计划。请先询问我的优先事项和可用时间。" }],
      [{ label: "查找错误", prompt: "帮我调试代码。先询问代码、报错信息和预期行为，再逐步分析。" }, { label: "优化代码", prompt: "帮我提高代码的可读性。先询问代码和项目限制，再解释建议的修改。" }, { label: "规划项目", prompt: "我想构建一个软件项目。请询问用途、目标用户和我的经验，然后一起制定可执行的计划。" }],
      [{ label: "想象建筑", prompt: "宁静景观中的极简建筑，钴蓝色门廊，柔和自然光，石材质感，电影感构图，无文字或标志。" }, { label: "产品摄影", prompt: "浅色石面上的简洁玻璃瓶棚拍，柔和侧光、自然阴影、简约专业的构图，无文字或标志。" }, { label: "创意海报", prompt: "蓝色与银色几何形状组成的抽象海报，大量留白、细腻光线与未来感，无文字或标志。" }],
    ],
    try: "或从一个想法开始", continue: "在对话中继续", imageContinue: "在工作室中继续", opening: "正在打开…", draftNote: "草稿将在工作空间打开，由你决定何时发送。", workspace: "直接进入工作空间", seeMore: "探索工作空间", keyboard: "继续", pillars: ["对话与写作", "代码与问题求解", "创作与下载图像"],
    studioKicker: "01 / 图像工作室", studioTitle: "想象它。", studioAccent: "让它成形。", studioBody: "从描述开始。选择模型，查看生成进度，一键下载完成的图像。", studioCta: "把想法变成图像", studioPromptLabel: "一个起始灵感", studioPrompt: "极简建筑。钴蓝。柔光。介于现实与想象之间。", artworkLabel: "用于启发灵感的概念作品", artworkAlt: "浅色极简建筑中的钴蓝色门廊，用于启发灵感的概念艺术作品", studioNotes: ["描述图像并选择模型", "下载完成的图像"],
    workflowKicker: "02 / 保持创作节奏", workflowTitle: "减少切换。\n专注创作。", workflowBody: "所需工具近在手边，从第一个问题到继续上次的工作。",
    workflow: [
      { title: "在对话中理清思路", text: "书写、提问，跟随回答逐步展开。随时暂停，再换个方向思考。", link: "开始对话" },
      { title: "找到适合工作的工具", text: "了解可用模型与能力，为写作、编程或图像创作做出合适的选择。", link: "探索模型" },
      { title: "从上次停下的地方继续", text: "从历史记录返回之前的对话。昨天的想法，可以成为今天的起点。", link: "打开工作空间" },
    ],
    finalKicker: "下一个想法，从这里开始", finalTitle: "你的工作空间。\n为想法留出余地。", finalBody: "开始探索工具。选择套餐时，比较功能与限制，找到适合工作的方案。", finalCta: "开始实现你的想法", plans: "比较套餐", privacy: "隐私", terms: "使用条款",
  },
};

const modeIcons = [MessageCircleMore, Code2, ImageIcon];
const workflowIcons = [MessageCircleMore, Layers3, History];

export function PortalLanding() {
  return <PublicShell>{(locale, session) => <LandingContent locale={locale} session={session} />}</PublicShell>;
}

function LandingContent({ locale, session }: { locale: PublicLocale; session: PublicSessionContext }) {
  const t = copy[locale];
  const [mode, setMode] = useState(0);
  const [drafts, setDrafts] = useState<[string, string, string]>(["", "", ""]);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const router = useRouter();
  const rtl = locale === "fa" || locale === "ar";
  const DirectionArrow = rtl ? ArrowUpLeft : ArrowUpRight;
  const draft = drafts[mode];
  const studioHref = session.status === "anonymous" ? "/studio?auth=register" : "/studio";

  function setDraft(value: string) {
    setDrafts((previous) => { const next: [string, string, string] = [...previous]; next[mode] = value; return next; });
  }
  function draftHref(value: string, image = mode === 2) {
    const base = image ? studioHref : session.startHref;
    return `${base}#${new URLSearchParams({ draft: value })}`;
  }
  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    // Carry a draft only. Authentication and sending remain workspace actions.
    startTransition(() => router.push(draftHref(draft.trim())));
  }

  return <div className={styles.landing}>
    <section className={styles.hero} aria-labelledby={`${composerId}-title`}>
      <div className={styles.eyebrow}><span aria-hidden="true" />{t.eyebrow}</div>
      <h1 id={`${composerId}-title`}>{t.title}<span>{t.accent}</span></h1>
      <p className={styles.heroIntro}>{t.intro}</p>
      <div className={styles.startArea}>
        <form className={styles.composer} onSubmit={submitDraft} aria-busy={pending}>
          <div className={styles.composerHead}>
            <div className={styles.tabs} role="tablist" aria-label={t.question} onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const step = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
              const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (mode + step + 3) % 3;
              setMode(next);
              event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
            }}>
              {t.modes.map((label, index) => { const Icon = modeIcons[index]; return <button type="button" role="tab" key={index} id={`${composerId}-tab-${index}`} aria-controls={`${composerId}-panel`} aria-selected={mode === index} tabIndex={mode === index ? 0 : -1} data-mode={index} onClick={() => setMode(index)}><Icon size={16} aria-hidden="true" />{label}</button>; })}
            </div>
            <span className={styles.composerMark} aria-hidden="true"><Sparkles size={17} /></span>
          </div>
          <div role="tabpanel" id={`${composerId}-panel`} aria-labelledby={`${composerId}-tab-${mode}`}>
            <label className={styles.inputLabel} htmlFor={`${composerId}-input`}>{t.question}</label>
            <textarea ref={textareaRef} id={`${composerId}-input`} className={styles.promptInput} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.placeholders[mode]} aria-describedby={`${composerId}-note`} maxLength={800} rows={2} dir="auto" onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} />
          </div>
          <div className={styles.composerFoot}>
            <span className={styles.keyboardHint}><kbd dir="ltr">Ctrl / ⌘ ↵</kbd>{t.keyboard}</span>
            {draft.length > 650 && <span className={styles.characterCount} dir="ltr">{draft.length} / 800</span>}
            <button type="submit" className={styles.submit} disabled={!draft.trim() || pending}>
              {pending ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
              <span>{pending ? t.opening : mode === 2 ? t.imageContinue : t.continue}</span>
            </button>
          </div>
        </form>
        <p className={styles.draftNote} id={`${composerId}-note`}><Check size={13} aria-hidden="true" />{t.draftNote}</p>
        <div className={styles.suggestions}><span>{t.try}</span>{t.starters[mode].map((starter) => <button type="button" key={starter.label} onClick={() => { setDraft(starter.prompt); textareaRef.current?.focus(); }}><Plus size={13} aria-hidden="true" />{starter.label}</button>)}</div>
        <Link href={session.startHref} className={styles.workspaceLink}>{t.workspace}<DirectionArrow size={15} aria-hidden="true" /></Link>
      </div>
      <div className={styles.heroBottom}>
        <div className={styles.pillars}>{t.pillars.map((text, index) => { const Icon = modeIcons[index]; return <span key={text}><Icon size={16} aria-hidden="true" />{text}</span>; })}</div>
        <a className={styles.discover} href="#image-studio">{t.seeMore}<ArrowDown size={15} aria-hidden="true" /></a>
      </div>
    </section>

    <section className={styles.studio} id="image-studio" aria-labelledby={`${composerId}-studio-title`}>
      <div className={styles.studioCopy}>
        <span className={styles.kicker}>{t.studioKicker}</span>
        <h2 id={`${composerId}-studio-title`}>{t.studioTitle}<span>{t.studioAccent}</span></h2>
        <p>{t.studioBody}</p>
        <Link className={styles.primaryLink} href={studioHref}>{t.studioCta}<DirectionArrow size={18} aria-hidden="true" /></Link>
        <div className={styles.studioNotes}><span><Layers3 size={15} aria-hidden="true" />{t.studioNotes[0]}</span><span><Download size={15} aria-hidden="true" />{t.studioNotes[1]}</span></div>
      </div>
      <figure className={styles.artwork}>
        <Image unoptimized src="/portal-studio-art.webp" alt={t.artworkAlt} fill sizes="(max-width: 760px) 100vw, 58vw" className={styles.artworkImage} />
        <span className={styles.artworkTag}><Sparkles size={13} aria-hidden="true" />{t.artworkLabel}</span>
        <figcaption className={styles.artworkCaption}><div><span>{t.studioPromptLabel}</span><p>{t.studioPrompt}</p></div><Link href={draftHref(t.starters[2][0].prompt, true)} className={styles.artworkAction} aria-label={t.studioCta} title={t.studioCta}><DirectionArrow size={23} aria-hidden="true" /></Link></figcaption>
      </figure>
    </section>

    <section className={styles.workflow} aria-labelledby={`${composerId}-workflow-title`}>
      <header className={styles.workflowIntro}><span className={styles.kicker}>{t.workflowKicker}</span><h2 id={`${composerId}-workflow-title`}>{t.workflowTitle}</h2><p>{t.workflowBody}</p><div className={styles.workflowGlyph} aria-hidden="true"><span /><span /><span /><Sparkles size={36} strokeWidth={1.25} /></div></header>
      <div className={styles.workflowList}>{t.workflow.map((item, index) => { const Icon = workflowIcons[index]; return <article className={styles.workflowItem} key={item.title}><span className={styles.workflowIcon}><Icon size={21} strokeWidth={1.6} aria-hidden="true" /></span><div><h3>{item.title}</h3><p>{item.text}</p><Link href={index === 1 ? "/models" : session.startHref}>{item.link}<DirectionArrow size={15} aria-hidden="true" /></Link></div></article>; })}</div>
    </section>

    <section className={styles.finale} aria-labelledby={`${composerId}-final-title`}>
      <div className={styles.finaleCopy}><span className={styles.kicker}>{t.finalKicker}</span><h2 id={`${composerId}-final-title`}>{t.finalTitle}</h2></div>
      <div className={styles.finaleActions}><p>{t.finalBody}</p><Link className={styles.primaryLink} href={session.startHref}>{session.isAuthenticated ? t.workspace : t.finalCta}<DirectionArrow size={18} aria-hidden="true" /></Link><Link className={styles.plansLink} href="/plans">{t.plans}<DirectionArrow size={16} aria-hidden="true" /></Link><div className={styles.legalLinks}><ShieldCheck size={14} aria-hidden="true" /><Link href="/privacy">{t.privacy}</Link><span aria-hidden="true">·</span><Link href="/terms">{t.terms}</Link></div></div>
    </section>
  </div>;
}
