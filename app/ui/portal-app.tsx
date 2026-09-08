"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUpRight,
  Lightbulb,
  Palette,
  PenLine,
  WandSparkles,
  WifiOff,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Download,
  FileText,
  Home,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  LogIn,
  Menu,
  MessageCircleMore,
  Copy,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AuthDialog } from "./auth-dialog";
import { useAuthSession } from "./auth-session";
import { AccountHub, PlanBadge } from "./account-hub";
import { tr } from "./i18n";
import { MarkdownLite } from "./markdown";
import { GeneratedImage } from "./generated-image";
import { GenerationStatus } from "./generation-status";
import { createSseParser, abortableDelay, advanceStreamText } from "./streaming-text";
import { appendPromptStyle, draftFromQuery, groupHistory } from "./workspace-helpers";
import styles from "./portal-app.module.css";
import { ConfirmDialog, ToastNotice, type UiNotice } from "./ui-feedback";

type Locale = "fa" | "en" | "ar" | "zh";
type Model = {
  id: string;
  name: string;
  description?: string;
  type: "text" | "image";
  creditCost?: number;
  available?: boolean;
  requiredPlan?: string;
  isDefault?: boolean;
  provider?: string;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  interrupted?: boolean;
  imageUrl?: string;
  kind?: "text" | "image";
  startedAt?: number;
};
type Conversation = {
  id: string;
  title: string;
  model_alias: string;
  updated_at: string;
};
type Usage = {
  text: Array<{
    window: string;
    used: number;
    limit: number;
    usedPercent: number;
    resetAt: string;
  }>;
  image: {
    used: number;
    limit: number;
    usedPercent: number;
    window: string;
    resetAt?: string;
  };
};
type HistoryState = "idle" | "loading" | "ready" | "error";
type TurnPayload = { role: "user" | "assistant"; content: string };
type InterruptedTurn = {
  assistantId: string;
  turnId: string | null;
  modelId: string;
  fileIds: string[];
  payloadMessages: TurnPayload[];
};

const localeMeta: Record<Locale, { label: string; dir: "rtl" | "ltr"; tag: string }> = {
  fa: { label: "فارسی", dir: "rtl", tag: "fa-IR" },
  en: { label: "English", dir: "ltr", tag: "en-US" },
  ar: { label: "العربية", dir: "rtl", tag: "ar" },
  zh: { label: "中文", dir: "ltr", tag: "zh-CN" },
};

const copy: Record<Locale, Record<string, string>> = {
  fa: {
    newChat: "گفت‌وگوی جدید",
    search: "جست‌وجو در گفت‌وگوها",
    recent: "گفت‌وگوهای اخیر",
    noHistory: "هنوز گفت‌وگویی نداری",
    historyUnavailable: "دریافت تاریخچه ممکن نشد",
    signInHistory: "برای دیدن تاریخچه وارد شو",
    retry: "تلاش دوباره",
    home: "صفحه اصلی",
    admin: "پنل مدیریت",
    signIn: "ورود",
    signOut: "خروج",
    language: "زبان",
    theme: "تغییر پوسته",
    menu: "باز کردن منو",
    close: "بستن",
    text: "متن",
    image: "تصویر",
    ready: "Sirius آماده است",
    textQuestion: "امروز روی چه چیزی کار می‌کنیم؟",
    imageQuestion: "چه تصویری در ذهن داری؟",
    textIntro: "از یک سؤال ساده تا یک پروژه جدی، از همین‌جا شروع کن.",
    imageIntro: "صحنه، سبک و جزئیات را توصیف کن؛ Portal AI بقیه مسیر را مدیریت می‌کند.",
    s1: "برنامه‌ریزی پروژه",
    s1sub: "یک مسیر اجرایی دقیق بساز",
    s1prompt: "یک برنامه کاری حرفه‌ای برای پروژه من طراحی کن",
    s2: "تحلیل کد",
    s2sub: "ایرادها و بهبودها را پیدا کن",
    s2prompt: "این کد را از نظر امنیت و کارایی بررسی کن",
    s3: "ساخت تصویر",
    s3sub: "ایده را به تصویر تبدیل کن",
    s3prompt: "یک تصویر سینمایی مینیمال با نور آبی و بنفش بساز",
    textPlaceholder: "پیامت را برای Portal AI بنویس…",
    imagePlaceholder: "تصویری که می‌خواهی را با جزئیات توصیف کن…",
    live: "پاسخ زنده",
    credit: "اعتبار",
    disclaimer: "Portal AI ممکن است اشتباه کند؛ پاسخ‌های مهم را بررسی کن. فایل‌ها حداکثر ۵۰ مگابایت هستند.",
    fileSize: "مجموع حجم فایل‌ها نباید بیشتر از ۵۰ مگابایت باشد.",
    fileCount: "تعداد فایل‌ها بیشتر از سقف پلن تو است.",
    uploadFailed: "بارگذاری فایل انجام نشد",
    generating: "در حال ساخت تصویر",
    imageReady: "تصویر آماده شد.",
    imageTimeout: "ساخت تصویر بیشتر از زمان معمول طول کشید؛ نتیجه در تاریخچه ذخیره می‌شود.",
    error: "خطا",
    deleteConfirm: "این گفت‌وگو حذف شود؟",
    deleteBody: "این گفت‌وگو از تاریخچه حذف می‌شود و قابل بازگردانی نیست.",
    delete: "حذف گفت‌وگو",
    export: "خروجی Markdown",
    loading: "در حال دریافت گفت‌وگوها…",
    planUsage: "مصرف این بازه",
    conversationFailed: "گفت‌وگو در دسترس نیست.",
    models: "همه مدل‌ها",
    plans: "اشتراک‌ها",
    account: "حساب من",
    settings: "تنظیمات",
    studio: "استودیوی تصویر",
    attach: "افزودن فایل",
    switchMode: "تغییر حالت تصویر",
    send: "ارسال پیام",
    removeFile: "حذف فایل",
    selectModel: "انتخاب مدل",
    modelLocked: "این مدل از پلن {plan} فعال می‌شود.",
    conversation: "گفت\u200cوگو",
    stop: "توقف تولید پاسخ",
    turnInterrupted: "اتصال هنگام پاسخ قطع شد؛ همین‌جا ادامه بده:",
    emptyResponse: "پاسخی از مدل دریافت نشد؛ دوباره تلاش کن.",
    connectionDropped: "اتصال برقرار نشد؛ دوباره تلاش کن.",
    loadingConversation: "در حال بازکردن گفت\u200cوگو…",
  },
  en: {
    newChat: "New chat",
    search: "Search conversations",
    recent: "Recent conversations",
    noHistory: "No conversations yet",
    historyUnavailable: "Could not load conversation history",
    signInHistory: "Sign in to view your history",
    retry: "Try again",
    home: "Home",
    admin: "Admin panel",
    signIn: "Sign in",
    signOut: "Sign out",
    language: "Language",
    theme: "Change theme",
    menu: "Open menu",
    close: "Close",
    text: "Text",
    image: "Image",
    ready: "Sirius is ready",
    textQuestion: "What are we working on today?",
    imageQuestion: "What image do you have in mind?",
    textIntro: "Start with anything, from a quick question to a serious project.",
    imageIntro: "Describe the scene, style, and details; Portal AI will handle the rest.",
    s1: "Plan a project",
    s1sub: "Build a precise execution path",
    s1prompt: "Create a professional work plan for my project",
    s2: "Review code",
    s2sub: "Find risks and improvements",
    s2prompt: "Review this code for security and performance",
    s3: "Create an image",
    s3sub: "Turn an idea into an image",
    s3prompt: "Create a minimalist cinematic image with blue and violet light",
    textPlaceholder: "Message Portal AI…",
    imagePlaceholder: "Describe the image you want in detail…",
    live: "Live response",
    credit: "credits",
    disclaimer: "Portal AI can make mistakes. Verify important answers. Files are limited to 50 MB.",
    fileSize: "Total file size cannot exceed 50 MB.",
    fileCount: "This exceeds your plan's file limit.",
    uploadFailed: "File upload failed",
    generating: "Generating image",
    imageReady: "Image is ready.",
    imageTimeout: "Generation is taking longer than usual; the result will remain in history.",
    error: "Error",
    deleteConfirm: "Delete this conversation?",
    deleteBody: "This conversation will be permanently removed from your history.",
    delete: "Delete conversation",
    export: "Export Markdown",
    loading: "Loading conversations…",
    planUsage: "Current usage",
    conversationFailed: "Conversation is unavailable.",
    models: "All models",
    plans: "Plans",
    account: "My account",
    settings: "Settings",
    studio: "Image studio",
    attach: "Attach files",
    switchMode: "Switch image mode",
    send: "Send message",
    removeFile: "Remove file",
    selectModel: "Select model",
    modelLocked: "This model is available on the {plan} plan.",
    conversation: "Conversation",
    stop: "Stop generating",
    turnInterrupted: "The connection dropped mid-answer. Continue from here:",
    emptyResponse: "The model returned no answer. Please try again.",
    connectionDropped: "Connection failed. Please try again.",
    loadingConversation: "Opening conversation…",
  },
  ar: {
    newChat: "محادثة جديدة",
    search: "البحث في المحادثات",
    recent: "المحادثات الأخيرة",
    noHistory: "لا توجد محادثات بعد",
    historyUnavailable: "تعذر تحميل سجل المحادثات",
    signInHistory: "سجّل الدخول لعرض السجل",
    retry: "حاول مجدداً",
    home: "الرئيسية",
    admin: "لوحة الإدارة",
    signIn: "دخول",
    signOut: "خروج",
    language: "اللغة",
    theme: "تغيير المظهر",
    menu: "فتح القائمة",
    close: "إغلاق",
    text: "نص",
    image: "صورة",
    ready: "Sirius جاهز",
    textQuestion: "على ماذا سنعمل اليوم؟",
    imageQuestion: "ما الصورة التي تتخيلها؟",
    textIntro: "ابدأ بأي شيء، من سؤال سريع إلى مشروع جاد.",
    imageIntro: "صف المشهد والأسلوب والتفاصيل؛ وسيتولى Portal AI الباقي.",
    s1: "تخطيط مشروع",
    s1sub: "أنشئ مسار تنفيذ دقيق",
    s1prompt: "أنشئ خطة عمل احترافية لمشروعي",
    s2: "مراجعة الكود",
    s2sub: "اكتشف المخاطر والتحسينات",
    s2prompt: "راجع هذا الكود من ناحية الأمان والأداء",
    s3: "إنشاء صورة",
    s3sub: "حوّل الفكرة إلى صورة",
    s3prompt: "أنشئ صورة سينمائية بسيطة بإضاءة زرقاء وبنفسجية",
    textPlaceholder: "اكتب رسالتك إلى Portal AI…",
    imagePlaceholder: "صف الصورة التي تريدها بالتفصيل…",
    live: "إجابة مباشرة",
    credit: "رصيد",
    disclaimer: "قد يخطئ Portal AI؛ تحقق من الإجابات المهمة. الحد الأقصى للملفات 50 ميغابايت.",
    fileSize: "يجب ألا يتجاوز مجموع الملفات 50 ميغابايت.",
    fileCount: "عدد الملفات يتجاوز حد خطتك.",
    uploadFailed: "فشل رفع الملف",
    generating: "جارٍ إنشاء الصورة",
    imageReady: "الصورة جاهزة.",
    imageTimeout: "يستغرق الإنشاء وقتاً أطول؛ ستبقى النتيجة في السجل.",
    error: "خطأ",
    deleteConfirm: "هل تريد حذف هذه المحادثة؟",
    deleteBody: "ستُزال هذه المحادثة نهائياً من السجل.",
    delete: "حذف المحادثة",
    export: "تصدير Markdown",
    loading: "جارٍ تحميل المحادثات…",
    planUsage: "استخدام الفترة",
    conversationFailed: "المحادثة غير متاحة.",
    models: "كل النماذج",
    plans: "الاشتراكات",
    account: "حسابي",
    settings: "الإعدادات",
    studio: "استوديو الصور",
    attach: "إرفاق ملفات",
    switchMode: "تغيير وضع الصور",
    send: "إرسال الرسالة",
    removeFile: "حذف الملف",
    selectModel: "اختيار النموذج",
    modelLocked: "يتوفر هذا النموذج في خطة {plan}.",
    conversation: "محادثة",
    stop: "إيقاف التوليد",
    turnInterrupted: "انقطع الاتصال أثناء الإجابة. تابع من هنا:",
    emptyResponse: "لم يصل أي رد من النموذج. حاول مجدداً.",
    connectionDropped: "فشل الاتصال. حاول مجدداً.",
    loadingConversation: "جارٍ فتح المحادثة…",
  },
  zh: {
    newChat: "新对话",
    search: "搜索对话",
    recent: "最近对话",
    noHistory: "还没有对话",
    historyUnavailable: "无法加载对话记录",
    signInHistory: "登录后查看记录",
    retry: "重试",
    home: "主页",
    admin: "管理面板",
    signIn: "登录",
    signOut: "退出",
    language: "语言",
    theme: "切换主题",
    menu: "打开菜单",
    close: "关闭",
    text: "文本",
    image: "图像",
    ready: "Sirius 已就绪",
    textQuestion: "今天要处理什么？",
    imageQuestion: "你想生成什么图像？",
    textIntro: "从一个简单问题到严肃项目，都可以从这里开始。",
    imageIntro: "描述场景、风格和细节，其余交给 Portal AI。",
    s1: "项目规划",
    s1sub: "制定清晰的执行路线",
    s1prompt: "为我的项目制定专业工作计划",
    s2: "代码审查",
    s2sub: "发现风险与改进点",
    s2prompt: "从安全和性能角度审查这段代码",
    s3: "生成图像",
    s3sub: "把想法变成图像",
    s3prompt: "生成一张蓝紫光影的极简电影感图像",
    textPlaceholder: "给 Portal AI 发消息…",
    imagePlaceholder: "详细描述你想要的图像…",
    live: "实时回复",
    credit: "积分",
    disclaimer: "Portal AI 可能出错，请核实重要答案。文件上限为 50 MB。",
    fileSize: "文件总大小不能超过 50 MB。",
    fileCount: "文件数量超过当前套餐限制。",
    uploadFailed: "文件上传失败",
    generating: "正在生成图像",
    imageReady: "图像已生成。",
    imageTimeout: "生成时间比平时更长；结果会保留在历史记录中。",
    error: "错误",
    deleteConfirm: "删除此对话？",
    deleteBody: "此对话将从历史记录中永久删除。",
    delete: "删除对话",
    export: "导出 Markdown",
    loading: "正在加载对话…",
    planUsage: "本周期用量",
    conversationFailed: "对话暂不可用。",
    models: "全部模型",
    plans: "套餐",
    account: "我的账户",
    settings: "设置",
    studio: "图像工作室",
    attach: "添加文件",
    switchMode: "切换图像模式",
    send: "发送消息",
    removeFile: "移除文件",
    selectModel: "选择模型",
    modelLocked: "该模型在 {plan} 套餐中可用。",
    conversation: "对话",
    stop: "停止生成",
    turnInterrupted: "回答过程中连接中断，从这里继续：",
    emptyResponse: "模型未返回任何回答，请重试。",
    connectionDropped: "连接失败，请重试。",
    loadingConversation: "正在打开对话…",
  },
};

const fallbackModels: Model[] = [
  {
    id: "sirius",
    name: "Sirius",
    description: "پیش‌فرض سریع و اقتصادی Portal AI",
    type: "text",
    creditCost: 1,
    available: true,
    isDefault: true,
    provider: "Portal AI",
  },
  {
    id: "glm-5-1",
    name: "GLM 5.1",
    description: "مدل سریع و کم‌هزینه Z.ai",
    type: "text",
    creditCost: 1,
    available: true,
    provider: "Z.ai",
  },
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    description: "ساخت تصویر با OpenAI",
    type: "image",
    creditCost: 1,
    available: true,
    provider: "OpenAI",
  },
];

const modelDescriptions: Record<Locale, Record<string, string>> = {
  fa: {
    sirius: "متعادل و هوشمند",
    "text-reasoning": "استدلال عمیق",
    "text-code": "برنامه‌نویسی",
    "text-fast": "سریع و اقتصادی",
    "text-pro": "کارهای پیچیده",
    "image-studio": "کیفیت بالا",
    "image-fast": "سریع",
  },
  en: {
    sirius: "Balanced and smart",
    "text-reasoning": "Deep reasoning",
    "text-code": "Programming",
    "text-fast": "Fast and efficient",
    "text-pro": "Complex work",
    "image-studio": "High quality",
    "image-fast": "Fast",
  },
  ar: {
    sirius: "متوازن وذكي",
    "text-reasoning": "استدلال عميق",
    "text-code": "برمجة",
    "text-fast": "سريع واقتصادي",
    "text-pro": "مهام معقدة",
    "image-studio": "جودة عالية",
    "image-fast": "سريع",
  },
  zh: {
    sirius: "均衡智能",
    "text-reasoning": "深度推理",
    "text-code": "编程",
    "text-fast": "快速经济",
    "text-pro": "复杂任务",
    "image-studio": "高质量",
    "image-fast": "快速",
  },
};

const workspaceCopy: Record<Locale, Record<string, string>> = {
  fa: {
    footerNote: "Portal AI ممکن است اشتباه کند؛ پاسخ‌های مهم را بررسی کن.",
    visualExample: "نمونه الهام‌بخش", useIdea: "از این ایده شروع کن", showcasePrompt: "یک مجسمه روبانی بزرگ از سنگ آبی کبالت در حیاطی مینیمال با دیوارهای تراورتن روشن، استخر کم‌عمق با بازتاب نور، درختان زیتون، آسمان صاف و نور گرم طبیعی؛ عکاسی معماری واقع‌گرا، بدون نوشته.",
    workspace: "فضای کار شما", textMode: "گفت‌وگو", imageMode: "استودیوی تصویر",
    today: "امروز", yesterday: "دیروز", week: "۷ روز گذشته", older: "قدیمی‌تر",
    noResults: "گفت‌وگویی با این عبارت پیدا نشد", clearSearch: "پاک کردن جست‌وجو",
    promptIdeas: "برای شروع، یک ایده انتخاب کن", imageIdeas: "از یک ایده تا تصویر تو",
    writing: "نوشتن و ویرایش", writingSub: "متنت را واضح‌تر و بهتر کن",
    writingPrompt: "می‌خواهم یک متن بنویسم. ابتدا درباره مخاطب، هدف و لحن مناسب از من بپرس.",
    imgProduct: "عکاسی محصول", imgProductSub: "نور استودیویی · جزئیات دقیق",
    imgProductPrompt: "عکاسی تبلیغاتی از یک شیشه عطر شفاف روی پایه سنگی آبی، نور نرم استودیویی از کنار، قطره‌های آب، پس‌زمینه ساده، جزئیات دقیق و واقعی، بدون نوشته یا لوگو.",
    imgSpace: "معماری آرام", imgSpaceSub: "فضای مینیمال · نور طبیعی",
    imgSpacePrompt: "فضای داخلی یک خانه مدرن و آرام، دیوارهای گچی روشن، مبلمان ساده چوبی، پنجره بزرگ رو به باغ، نور طبیعی صبحگاهی و سایه‌های نرم، ترکیب‌بندی معماری حرفه‌ای، بدون نوشته.",
    imgArt: "دنیای خیال", imgArtSub: "تصویرسازی · رنگ‌های جسور",
    imgArtPrompt: "تصویرسازی یک جزیره شناور با درختان کوچک و خانه‌ای روشن، آسمان آبی عمیق، ابرهای نرم، فضای رویایی و جزئیات ظریف، رنگ‌های هماهنگ آبی و مرجانی، بدون نوشته.",
    styleLabel: "حال‌وهوای تصویر", cinematic: "سینمایی", cinematicPrompt: "سبک سینمایی، نورپردازی دراماتیک و عمق میدان کم.",
    natural: "طبیعی", naturalPrompt: "سبک عکاسی طبیعی، رنگ‌های واقعی و نور روز نرم.",
    minimal: "مینیمال", minimalPrompt: "ترکیب‌بندی مینیمال، پس‌زمینه خلوت و فضای منفی کافی.",
    illustrated: "تصویرسازی", illustratedPrompt: "سبک تصویرسازی هنری با فرم‌های نرم و جزئیات دقیق.",
    styleLimit: "برای افزودن سبک، کمی از متن را کوتاه کن.",
    imageGuide: "سوژه + محیط + نور + سبک؛ هرچه دقیق‌تر، نتیجه نزدیک‌تر به ایده تو.",
    shortcut: "Enter برای ارسال · Shift + Enter برای خط جدید", ctrlSend: "Ctrl / ⌘ + Enter برای ارسال",
    latest: "آخرین پیام", offline: "اتصال اینترنت قطع است؛ پیامت اینجا می‌ماند.", uploading: "در حال بارگذاری فایل‌ها…",
    modelSearch: "جست‌وجوی مدل یا ارائه‌دهنده…", noModels: "مدلی پیدا نشد.", skip: "رفتن به نوشتن پیام",
    assistant: "Portal AI", you: "شما", attachmentHint: "متن، کد و فایل", imageResult: "تصویر قابل دانلود",
    draftAdded: "ایده آماده است؛ قبل از ارسال آن را ویرایش کن.", characters: "کاراکتر", generatingMeta: "در حال انجام", historySearch: "جست‌وجوی تاریخچه",
  },
  en: {
    footerNote: "Portal AI can make mistakes. Verify important answers.",
    visualExample: "Visual inspiration", useIdea: "Start with this idea", showcasePrompt: "A monumental ribbon sculpture in cobalt blue stone inside a minimalist courtyard with pale travertine walls, a shallow reflecting pool, olive trees, clear sky, and warm natural light; realistic architectural photography, no text.",
    workspace: "Your workspace", textMode: "Chat", imageMode: "Image studio",
    today: "Today", yesterday: "Yesterday", week: "Previous 7 days", older: "Earlier",
    noResults: "No conversations match your search", clearSearch: "Clear search",
    promptIdeas: "Pick an idea to get started", imageIdeas: "A starting point for your imagination",
    writing: "Write & refine", writingSub: "Make every word work harder",
    writingPrompt: "I want to write something. First ask me about the audience, purpose, and the right tone.",
    imgProduct: "Product photography", imgProductSub: "Studio light · precise detail",
    imgProductPrompt: "Advertising photograph of a transparent perfume bottle on a blue stone pedestal, soft studio side lighting, water droplets, clean background, precise realistic detail, no text or logos.",
    imgSpace: "Quiet architecture", imgSpaceSub: "Minimal spaces · natural light",
    imgSpacePrompt: "Interior of a quiet modern home, pale plaster walls, simple wooden furniture, a large window facing a garden, natural morning light and soft shadows, professional architectural composition, no text.",
    imgArt: "Imagined worlds", imgArtSub: "Illustration · expressive color",
    imgArtPrompt: "Illustration of a floating island with small trees and a glowing house, deep blue sky, soft clouds, dreamlike atmosphere and delicate detail, harmonious blue and coral colors, no text.",
    styleLabel: "Image mood", cinematic: "Cinematic", cinematicPrompt: "Cinematic style, dramatic lighting, and shallow depth of field.",
    natural: "Natural", naturalPrompt: "Natural photography style, realistic colors, and soft daylight.",
    minimal: "Minimal", minimalPrompt: "Minimal composition, a clean background, and generous negative space.",
    illustrated: "Illustrated", illustratedPrompt: "Artistic illustration style with soft shapes and precise details.",
    styleLimit: "Shorten your prompt a little to add this style.",
    imageGuide: "Subject + setting + light + style. Specific details bring the result closer to your idea.",
    shortcut: "Enter to send · Shift + Enter for a new line", ctrlSend: "Ctrl / ⌘ + Enter to send",
    latest: "Latest message", offline: "You are offline. Your message stays here.", uploading: "Uploading files…",
    modelSearch: "Search models or providers…", noModels: "No models found.", skip: "Skip to message",
    assistant: "Portal AI", you: "You", attachmentHint: "Text, code & files", imageResult: "Downloadable image",
    draftAdded: "Your idea is ready. Edit it before sending.", characters: "characters", generatingMeta: "In progress", historySearch: "Search history",
  },
  ar: {
    footerNote: "قد يخطئ Portal AI. تحقق من الإجابات المهمة.",
    visualExample: "مثال للإلهام", useIdea: "ابدأ بهذه الفكرة", showcasePrompt: "منحوتة شريطية كبيرة من حجر أزرق كوبالت في فناء بسيط بجدران ترافرتين فاتحة وحوض ماء ضحل عاكس وأشجار زيتون وسماء صافية وضوء طبيعي دافئ؛ تصوير معماري واقعي دون نص.",
    workspace: "مساحة عملك", textMode: "محادثة", imageMode: "استوديو الصور",
    today: "اليوم", yesterday: "أمس", week: "الأيام السبعة الماضية", older: "الأقدم",
    noResults: "لا توجد محادثات تطابق بحثك", clearSearch: "مسح البحث",
    promptIdeas: "اختر فكرة للبدء", imageIdeas: "نقطة انطلاق لخيالك",
    writing: "الكتابة والتحرير", writingSub: "اجعل نصك أوضح وأفضل",
    writingPrompt: "أريد كتابة نص. اسألني أولاً عن الجمهور والهدف والأسلوب المناسب.",
    imgProduct: "تصوير المنتجات", imgProductSub: "إضاءة استوديو · تفاصيل دقيقة",
    imgProductPrompt: "صورة إعلانية لزجاجة عطر شفافة على قاعدة حجرية زرقاء، إضاءة استوديو جانبية ناعمة، قطرات ماء، خلفية نظيفة، تفاصيل واقعية دقيقة، دون نص أو شعارات.",
    imgSpace: "عمارة هادئة", imgSpaceSub: "مساحات بسيطة · ضوء طبيعي",
    imgSpacePrompt: "تصميم داخلي لمنزل حديث وهادئ، جدران جصية فاتحة، أثاث خشبي بسيط، نافذة كبيرة تطل على حديقة، ضوء صباح طبيعي وظلال ناعمة، تكوين معماري احترافي، دون نص.",
    imgArt: "عوالم خيالية", imgArtSub: "رسم توضيحي · ألوان معبرة",
    imgArtPrompt: "رسم توضيحي لجزيرة عائمة بأشجار صغيرة ومنزل مضيء، سماء زرقاء عميقة، سحب ناعمة، أجواء حالمة وتفاصيل دقيقة، ألوان زرقاء ومرجانية متناغمة، دون نص.",
    styleLabel: "طابع الصورة", cinematic: "سينمائي", cinematicPrompt: "أسلوب سينمائي وإضاءة درامية وعمق ميدان ضحل.",
    natural: "طبيعي", naturalPrompt: "أسلوب تصوير طبيعي وألوان واقعية وضوء نهار ناعم.",
    minimal: "بسيط", minimalPrompt: "تكوين بسيط وخلفية نظيفة ومساحة فارغة واسعة.",
    illustrated: "رسم توضيحي", illustratedPrompt: "أسلوب رسم فني بأشكال ناعمة وتفاصيل دقيقة.",
    styleLimit: "اختصر الوصف قليلاً لإضافة هذا الأسلوب.",
    imageGuide: "الموضوع + المكان + الإضاءة + الأسلوب؛ التفاصيل تقرّب النتيجة من فكرتك.",
    shortcut: "Enter للإرسال · Shift + Enter لسطر جديد", ctrlSend: "Ctrl / ⌘ + Enter للإرسال",
    latest: "آخر رسالة", offline: "أنت غير متصل. ستبقى رسالتك هنا.", uploading: "جارٍ رفع الملفات…",
    modelSearch: "ابحث عن نموذج أو مزوّد…", noModels: "لم يتم العثور على نماذج.", skip: "الانتقال إلى كتابة رسالة",
    assistant: "Portal AI", you: "أنت", attachmentHint: "نصوص وأكواد وملفات", imageResult: "صورة قابلة للتنزيل",
    draftAdded: "فكرتك جاهزة؛ يمكنك تعديلها قبل الإرسال.", characters: "حرف", generatingMeta: "قيد التنفيذ", historySearch: "البحث في السجل",
  },
  zh: {
    footerNote: "Portal AI 可能出错，请核实重要答案。",
    visualExample: "灵感示例", useIdea: "从这个想法开始", showcasePrompt: "一座钴蓝色石质巨型丝带雕塑，置于浅色洞石墙壁的极简庭院中，浅浅的倒影水池、橄榄树、晴朗天空和温暖自然光；写实建筑摄影，无文字。",
    workspace: "你的工作空间", textMode: "对话", imageMode: "图像工作室",
    today: "今天", yesterday: "昨天", week: "过去 7 天", older: "更早",
    noResults: "没有匹配的对话", clearSearch: "清除搜索",
    promptIdeas: "选择一个想法开始", imageIdeas: "给想象力一个起点",
    writing: "写作与润色", writingSub: "让文字更清晰、有力",
    writingPrompt: "我想写一篇文字。请先询问我的目标读者、写作目的和合适的语气。",
    imgProduct: "产品摄影", imgProductSub: "影棚光线 · 精细细节",
    imgProductPrompt: "透明香水瓶放在蓝色石质底座上的广告摄影，柔和的侧面影棚灯光，水滴，干净背景，精确逼真的细节，无文字或标志。",
    imgSpace: "静谧建筑", imgSpaceSub: "极简空间 · 自然光",
    imgSpacePrompt: "宁静现代住宅的室内空间，浅色灰泥墙壁，简单木质家具，面向花园的大窗户，自然晨光和柔和阴影，专业建筑构图，无文字。",
    imgArt: "想象的世界", imgArtSub: "插画 · 丰富色彩",
    imgArtPrompt: "漂浮岛屿的插画，有小树和发光的房屋，深蓝色天空，柔软云朵，梦幻氛围和精致细节，和谐的蓝色与珊瑚色，无文字。",
    styleLabel: "图像氛围", cinematic: "电影感", cinematicPrompt: "电影风格，戏剧性灯光和浅景深。",
    natural: "自然", naturalPrompt: "自然摄影风格，真实色彩和柔和日光。",
    minimal: "极简", minimalPrompt: "极简构图，干净背景和充足留白。",
    illustrated: "插画", illustratedPrompt: "艺术插画风格，柔和形状与精细细节。",
    styleLimit: "请缩短提示词以添加此风格。",
    imageGuide: "主体 + 场景 + 光线 + 风格。细节越具体，结果越接近你的想法。",
    shortcut: "Enter 发送 · Shift + Enter 换行", ctrlSend: "Ctrl / ⌘ + Enter 发送",
    latest: "最新消息", offline: "当前离线，你的消息会保留在这里。", uploading: "正在上传文件…",
    modelSearch: "搜索模型或提供商…", noModels: "未找到模型。", skip: "跳转到消息输入框",
    assistant: "Portal AI", you: "你", attachmentHint: "文字、代码与文件", imageResult: "可下载图像",
    draftAdded: "想法已准备好，发送前可以编辑。", characters: "字符", generatingMeta: "处理中", historySearch: "搜索历史记录",
  },
};

function Logo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      unoptimized
      className={className}
      src="/portal-ai-logo.png"
      width={80}
      height={80}
      alt="Portal AI"
      priority={priority}
    />
  );
}

function uploadMime(file: File) {
  const extension = file.name.toLowerCase().split(".").pop();
  const mapped: Record<string, string> = {
    ts: "text/typescript",
    tsx: "text/typescript",
    js: "text/javascript",
    jsx: "text/javascript",
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
  };

  return (extension && mapped[extension]) || file.type || "application/octet-stream";
}

function readPreference(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function savePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Preferences stay usable in memory. */ }
}

function getResolvedTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 8)}`;
}

// One stable identity per user turn: a retried turn reuses it so the server
// replaces the previous attempt instead of duplicating the user message.
function newTurnId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
}


export function PortalApp({ initialType = "text" }: { initialType?: "text" | "image" }) {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>("fa");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [hubAnchor, setHubAnchor] = useState<HTMLElement | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [offline, setOffline] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [catalog, setCatalog] = useState<Model[]>(fallbackModels);
  const [catalogOwner, setCatalogOwner] = useState<string | null | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<Model>(initialType === "image" ? fallbackModels.find((model) => model.type === "image") || fallbackModels[0] : fallbackModels[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>("idle");
  const [search, setSearch] = useState("");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const { status: authStatus, user: session, csrfToken: csrf, adopt: adoptSession, clear: clearSession, refresh: refreshSession } = useAuthSession();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<"login" | "register">("login");
  const [notice, setNotice] = useState<UiNotice>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [sendOnEnter, setSendOnEnter] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState(false);
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null);
  const [interruptedTurn, setInterruptedTurn] = useState<InterruptedTurn | null>(null);

  const preferenceSnapshot = useRef<{ locale: string | null; sendOnEnter: boolean; suggestions: boolean } | null>(null);
  const requestedPreference = useRef<string | null>(null);
  const requestedAuth = useRef<"login" | "register" | null>(null);
  const requestedPlan = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const messageScrollerRef = useRef<HTMLDivElement>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const streamAbort = useRef<AbortController | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const signedInUser = useRef<string | null>(null);
  const imagePollAbort = useRef<AbortController | null>(null);
  const openConversationAbort = useRef<AbortController | null>(null);
  const openSeq = useRef(0);
  const lastOpenRequest = useRef<Conversation | null>(null);
  const historySeq = useRef(0);
  const modelsSeq = useRef(0);
  const usageSeq = useRef(0);
  const messageContentRef = useRef<HTMLDivElement>(null);

  const t = copy[locale];
  const v = workspaceCopy[locale];
  const groupedHistory = useMemo(() => groupHistory(conversations), [conversations]);
  const ui = tr(locale);
  const direction = localeMeta[locale].dir;
  const modelGroups = useMemo(
    () =>
      Array.from(
        catalog.filter((model) => `${model.name} ${model.provider || ""} ${model.description || ""}`.toLocaleLowerCase().includes(modelSearch.toLocaleLowerCase().trim())).reduce((groups, model) => {
          const provider = model.provider || "Portal AI";
          groups.set(provider, [...(groups.get(provider) || []), model]);
          return groups;
        }, new Map<string, Model[]>()).entries(),
      ),
    [catalog, modelSearch],
  );
  const fileLimit = session?.plan === "ultra" ? 15 : session?.plan && session.plan !== "free" ? 10 : 3;

  const pushNotice = useCallback(
    (text: string, tone: "success" | "error" | "info" = "info") => setNotice({ text, tone }),
    [],
  );

  const copyMessage = useCallback(
    async (content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        pushNotice(tr(locale).chat.copied, "success");
      } catch {
        pushNotice(locale === "fa" ? "کپی انجام نشد؛ متن را انتخاب و کپی کن." : "Could not copy. Select the text and copy it manually.", "error");
      }
    },
    [locale, pushNotice],
  );

  const clearAuthQuery = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("auth")) return;
    url.searchParams.delete("auth");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const continuePlanSelection = useCallback(() => {
    const plan = requestedPlan.current;
    requestedPlan.current = null;
    if (!plan || !["starter", "plus", "pro", "ultra"].includes(plan)) return false;
    router.push(`/plans?selected=${encodeURIComponent(plan)}`);
    return true;
  }, [router]);

  const refreshModels = useCallback(async () => {
    const owner = signedInUser.current;
    const seq = ++modelsSeq.current;
    try {
      const response = await fetch("/api/models", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();

      if (seq !== modelsSeq.current || owner !== signedInUser.current) return;
      if (!response.ok || !Array.isArray(data.models) || !data.models.length) return;

      setCatalog(data.models);
      setCatalogOwner(owner);
      setSelectedModel((current) => {
        return (
          data.models.find((model: Model) => model.id === current.id && model.available) ||
          data.models.find((model: Model) => model.isDefault && model.available) ||
          data.models.find((model: Model) => model.available) ||
          data.models[0]
        );
      });
    } catch {
      // Keep the locally available fallback catalog.
    }
  }, []);

  const refreshConversations = useCallback(async (query = "", options?: { silent?: boolean }) => {
    const owner = signedInUser.current;
    if (!owner) return;
    const seq = ++historySeq.current;
    if (!options?.silent) setHistoryState("loading");

    try {
      const response = await fetch(`/api/conversations?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(12_000),
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error("Conversation history is unavailable.");
      if (seq !== historySeq.current || signedInUser.current !== owner) return; // a newer request already owns the list

      setConversations(data.conversations || []);
      setHistoryState("ready");
    } catch {
      if (seq !== historySeq.current || signedInUser.current !== owner) return;
      setHistoryState("error");
    }
  }, []);

  const refreshUsage = useCallback(async () => {
    const owner = signedInUser.current;
    if (!owner) return;
    const seq = ++usageSeq.current;
    try {
      const response = await fetch("/api/account/usage", {
        signal: AbortSignal.timeout(12_000),
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (seq === usageSeq.current && signedInUser.current === owner) setUsage(response.ok ? data : null);
    } catch {
      if (seq === usageSeq.current && signedInUser.current === owner) setUsage(null);
    }
  }, []);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const maxHeight = Math.min((window.visualViewport?.height || window.innerHeight) * 0.3, 200);
    const nextHeight = Math.max(48, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    const syncConnection = () => setOffline(!navigator.onLine);
    syncConnection();
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    return () => {
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
    };
  }, []);

  useEffect(() => {
    // Invalidate private view state when a different tab logs out or changes user.
    const userId = session?.id || null;
    if (signedInUser.current && signedInUser.current !== userId) {
      historySeq.current += 1;
      usageSeq.current += 1;
      openSeq.current += 1;
      streamAbort.current?.abort();
      uploadAbort.current?.abort();
      imagePollAbort.current?.abort();
      openConversationAbort.current?.abort();
      setMessages([]);
      setConversations([]);
      setCurrentConversationId(null);
      setUsage(null);
      setFiles([]);
      setPrompt("");
      setInterruptedTurn(null);
      setHistoryState("idle");
      setConversationLoading(false);
      setOpeningConversationId(null);
    }
    signedInUser.current = userId;
  }, [session?.id]);

  useEffect(() => {
    const savedChoice = readPreference("portal-theme-choice");
    const savedTheme = readPreference("portal-theme");
    const isSystemTheme = savedChoice === "system";
    const nextTheme =
      isSystemTheme ? getResolvedTheme() : savedChoice === "light" || savedChoice === "dark" ? savedChoice : savedTheme === "light" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.dataset.density =
      readPreference("portal-density") === "compact" ? "compact" : "comfortable";
    document.documentElement.dataset.motion =
      readPreference("portal-reduce-motion") === "true" ? "reduced" : "full";

    preferenceSnapshot.current ??= {
      locale: readPreference("portal-locale"),
      sendOnEnter: readPreference("portal-send-enter") !== "false",
      suggestions: readPreference("portal-show-suggestions") !== "false",
    };
    const savedLocale = preferenceSnapshot.current.locale as Locale | null;
    const savedSendOnEnter = preferenceSnapshot.current.sendOnEnter;
    const savedSuggestions = preferenceSnapshot.current.suggestions;
    queueMicrotask(() => {
      setSendOnEnter(savedSendOnEnter);
      setShowSuggestions(savedSuggestions);
      if (savedLocale && savedLocale in localeMeta) setLocale(savedLocale);
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleSystemTheme = () => {
      if (readPreference("portal-theme-choice") !== "system") return;
      document.documentElement.dataset.theme = getResolvedTheme();
      savePreference("portal-theme", getResolvedTheme());
    };

    mediaQuery.addEventListener("change", handleSystemTheme);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const draft = draftFromQuery(fragment.get("draft") ?? query.get("draft"), query.get("mode") === "image" ? "image" : initialType);
    if (draft !== null) {
      queueMicrotask(() => { setPrompt(draft); textareaRef.current?.focus(); });
      const url = new URL(window.location.href);
      url.searchParams.delete("draft");
      fragment.delete("draft");
      if (new URLSearchParams(url.hash.slice(1)).has("draft")) url.hash = fragment.toString();
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const requestedAuthMode = query.get("auth");
    const plan = query.get("plan");
    if (plan && ["starter", "plus", "pro", "ultra"].includes(plan)) requestedPlan.current = plan;
    requestedPreference.current =
      query.get("model") ||
      (query.get("mode") === "image" || initialType === "image"
        ? "__image__"
        : readPreference("portal-default-model"));

    if (requestedAuthMode === "login" || requestedAuthMode === "register") requestedAuth.current = requestedAuthMode;
    return () => {
      mediaQuery.removeEventListener("change", handleSystemTheme);
    };
  }, [initialType]);

  useEffect(() => {
    if (authStatus === "checking") return;
    void refreshModels();
  }, [authStatus, session?.id, refreshModels]);

  useEffect(() => {
    const intent = requestedAuth.current;
    if (!intent || authStatus === "checking") return;

    if (authStatus === "authenticated") {
      requestedAuth.current = null;
      clearAuthQuery();
      continuePlanSelection();
      return;
    }

    if (authStatus === "anonymous") {
      requestedAuth.current = null;
      setAuthInitialMode(intent);
      setAuthOpen(true);
      clearAuthQuery();
    }
  }, [authStatus, clearAuthQuery, continuePlanSelection]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const closeTimer = window.setTimeout(() => setAuthOpen(false), 0);
    return () => window.clearTimeout(closeTimer);
  }, [authStatus]);

  useEffect(() => {
    const preference = requestedPreference.current;
    if (!preference || !catalog.length || authStatus === "checking" || catalogOwner !== (session?.id || null)) return;

    const nextModel =
      preference === "__image__"
        ? catalog.find((model) => model.type === "image" && model.available)
        : catalog.find((model) => (model.id === preference || model.name === preference) && model.available);

    if (nextModel) {
      setSelectedModel(nextModel);
      if (nextModel.type === "image") setFiles([]);
      requestedPreference.current = null;
    }
  }, [catalog, catalogOwner, authStatus, session?.id]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    savePreference("portal-locale", locale);
  }, [direction, locale]);

  useEffect(() => {
    if (!session) return;

    const timer = window.setTimeout(() => void refreshConversations(search), 250);
    return () => window.clearTimeout(timer);
  }, [refreshConversations, search, session]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => void refreshUsage(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshUsage, session]);

  useEffect(() => {
    resizeTextarea();
  }, [prompt, resizeTextarea]);

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, [resizeTextarea]);

  useEffect(() => {
    const scroller = messageScrollerRef.current;
    if (!scroller || !shouldStickToBottom.current) return;

    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "auto",
    });
  }, [messages]);

  useEffect(() => {
    const content = messageContentRef.current;
    const scroller = messageScrollerRef.current;
    if (!content || !scroller) return;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottom.current) scroller.scrollTop = scroller.scrollHeight;
      else setShowScrollDown(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >= 96);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [messages.length, conversationLoading]);

  // Abort every in-flight request when the workspace goes away.
  useEffect(
    () => () => {
      streamAbort.current?.abort();
      uploadAbort.current?.abort();
      imagePollAbort.current?.abort();
      openConversationAbort.current?.abort();
    },
    [],
  );

  // iOS keyboards do not shrink 100dvh: follow the visual viewport so the
  // composer always stays above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const isIOS =
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--portal-vvh", `${viewport.height}px`);
      resizeTextarea();
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--portal-vvh");
    };
  }, [resizeTextarea]);

  useEffect(() => {
    if (!sidebarOpen && !modelOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSidebarOpen(false);
      if (modelOpen) modelButtonRef.current?.focus();
      setModelOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelPopoverRef.current?.contains(target)) setModelOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [modelOpen, sidebarOpen]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 960px)");
    const closeOnDesktop = () => { if (!mobile.matches) setSidebarOpen(false); };
    mobile.addEventListener("change", closeOnDesktop);
    return () => mobile.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    const sidebar = sidebarRef.current;
    const menuButton = menuButtonRef.current;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => sidebar?.querySelector<HTMLButtonElement>("button")?.focus(), 0);
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || document.querySelector('[role="dialog"]')) return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      if (sidebar?.contains(document.activeElement)) menuButton?.focus();
    };
  }, [sidebarOpen]);

  const chooseType = (type: "text" | "image") => {
    if (busy || conversationLoading || selectedModel.type === type) return;
    const nextModel =
      catalog.find((model) => model.type === type && model.available !== false) ||
      catalog.find((model) => model.type === type);
    if (!nextModel || nextModel.available === false) {
      pushNotice(t.modelLocked.replace("{plan}", nextModel?.requiredPlan || "Plus"), "info");
      return;
    }
    requestedPreference.current = null;
    setSelectedModel(nextModel);
    setModelOpen(false);
    if (type === "image") setFiles([]);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const chooseModel = (model: Model) => {
    if (model.available === false) {
      pushNotice(t.modelLocked.replace("{plan}", model.requiredPlan || "higher"), "info");
      return;
    }

    requestedPreference.current = null;
    setSelectedModel(model);
    setModelOpen(false);
    modelButtonRef.current?.focus();
    if (model.type === "image") setFiles([]);
  };

  const newChat = useCallback(() => {
    if (sendLock.current) return;
    requestedPreference.current = null;
    openSeq.current += 1;
    setShowScrollDown(false);

    const nextModel =
      catalog.find((model) => model.id === selectedModel.id && model.available !== false) ||
      catalog.find((model) => model.type === selectedModel.type && model.available !== false) ||
      catalog.find((model) => model.isDefault && model.available !== false) ||
      catalog.find((model) => model.available !== false) || catalog[0];

    openConversationAbort.current?.abort();
    shouldStickToBottom.current = true;
    setMessages([]);
    setCurrentConversationId(null);
    setFiles([]);
    setPrompt("");
    setSelectedModel(nextModel);
    setConversationLoading(false);
    setConversationError(false);
    setInterruptedTurn(null);
    setSidebarOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [catalog, selectedModel.id, selectedModel.type]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || (!event.ctrlKey && !event.metaKey) || document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (window.matchMedia("(max-width: 960px)").matches) setSidebarOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 30);
      } else if (event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [newChat]);

  const fillPrompt = (value: string) => {
    setPrompt(value);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const addStyle = (value: string) => {
    const next = appendPromptStyle(prompt, value);
    if (next === prompt && !prompt.includes(value)) pushNotice(v.styleLimit, "info");
    else fillPrompt(next);
  };

  const openConversation = async (conversation: Conversation) => {
    if (busy || conversationLoading) return;
    // Reopening the active conversation also fetches any completed background image.
    lastOpenRequest.current = conversation;
    openConversationAbort.current?.abort();
    const controller = new AbortController();
    openConversationAbort.current = controller;
    const seq = ++openSeq.current;

    setConversationLoading(true);
    setConversationError(false);
    setOpeningConversationId(conversation.id);
    setSidebarOpen(false);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.conversationFailed);
      if (controller.signal.aborted || seq !== openSeq.current) return;

      const loadedMessages = (data.messages || [])
        .filter((message: { role: string }) => message.role === "user" || message.role === "assistant")
        .map(
          (message: {
            id: string;
            role: "user" | "assistant";
            content: string;
            file_id?: string | null;
          }) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            imageUrl: message.file_id ? `/api/assets/${message.file_id}` : undefined,
          }),
        );

      shouldStickToBottom.current = true;
      setShowScrollDown(false);
      setMessages(loadedMessages);
      setCurrentConversationId(conversation.id);
      setInterruptedTurn(null);

      const conversationModel = catalog.find((model) => model.id === data.conversation?.model_alias);
      if (conversationModel) setSelectedModel(conversationModel);
    } catch {
      if (controller.signal.aborted || seq !== openSeq.current) return;
      setConversationError(true);
    } finally {
      if (seq === openSeq.current) {
        setConversationLoading(false);
        setOpeningConversationId(null);
      }
    }
  };

  const retryOpenConversation = () => {
    const conversation = lastOpenRequest.current;
    if (conversation) void openConversation(conversation);
  };

  const deleteConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-csrf-token": csrf },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t.conversationFailed);

      if (currentConversationId === id) newChat();
      setDeleteTarget(null);
      pushNotice(ui.chat.deleted, "success");
      await refreshConversations(search, { silent: true });
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : t.conversationFailed, "error");
    }
  };

  const attachFiles = (incoming: FileList | null) => {
    if (!incoming || selectedModel.type === "image" || sendLock.current) return;

    const nextFiles = [...files, ...Array.from(incoming)].filter((file, index, all) => all.findIndex((other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index);
    if (nextFiles.length > fileLimit) {
      pushNotice(t.fileCount, "error");
      return;
    }
    if (nextFiles.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) {
      pushNotice(t.fileSize, "error");
      return;
    }

    setFiles(nextFiles);
  };

  // Streams one assistant answer over the SSE protocol. Every failure mode is
  // handled in place — a raw "network error" never reaches the user, and
  // whatever already arrived always stays on screen.
  const runTextTurn = async (
    payloadMessages: TurnPayload[],
    turnId: string | null,
    assistantId: string,
    modelId: string,
    fileIds: string[],
  ) => {
    const owner = signedInUser.current;
    if (!owner) return;
    const controller = new AbortController();
    streamAbort.current = controller;

    let text = "";
    let displayed = "";
    let animationFrame = 0;
    let lastPaint = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    let outcome: "done" | "interrupted" | "error" | "stopped" | "disconnected" = "disconnected";
    let timedOut = false;
    let idleTimer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    const resetIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    };
    const publish = (snapshot: string) => {
      setMessages((current) => current.map((message) =>
        message.id === assistantId ? { ...message, content: snapshot, pending: true } : message,
      ));
    };
    const paint = (now: number) => {
      animationFrame = 0;
      if (now - lastPaint >= 32) {
        displayed = advanceStreamText(displayed, text, {
          elapsedMs: Math.min(100, now - lastPaint),
          reducedMotion: document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        });
        lastPaint = now;
        publish(displayed);
      }
      if (displayed !== text && !terminal) animationFrame = window.requestAnimationFrame(paint);
    };
    const parser = createSseParser({
      onEvent: ({ data }) => {
        if (terminal) return;
        const frame = JSON.parse(data) as { t?: string; v?: string; m?: string };
        if (frame.t === "delta" && typeof frame.v === "string") {
          text += frame.v;
          if (text.length > 2_000_000) throw new Error("RESPONSE_TOO_LARGE");
          if (!animationFrame) animationFrame = window.requestAnimationFrame(paint);
        } else if (frame.t === "done" || frame.t === "interrupted" || frame.t === "error") {
          outcome = frame.t;
          terminal = true;
          if (frame.t === "error" && frame.m) pushNotice(frame.m, "error");
        }
      },
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ model: modelId, messages: payloadMessages, conversationId: currentConversationId, fileIds, turnId }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        pushNotice(data.error || t.conversationFailed, "error");
        if (response.status === 401) void refreshSession();
        // Keep this turn retryable, including its prompt and attachment identities.
        outcome = "error";
      } else {
        const conversationId = response.headers.get("x-conversation-id");
        if (conversationId && signedInUser.current === owner) setCurrentConversationId(conversationId);
        reader = response.body.getReader();
        while (!terminal) {
          const { done, value } = await reader.read();
          if (done) { parser.finish(); break; }
          resetIdle();
          parser.push(value);
        }
      }
    } catch {
      outcome = controller.signal.aborted && !timedOut ? "stopped" : "disconnected";
    } finally {
      terminal = true;
      window.clearTimeout(idleTimer);
      window.cancelAnimationFrame(animationFrame);
      // Release the response connection on terminal frames as well as failures.
      if (reader) {
        try { await reader.cancel(); } catch { /* already closed */ }
        reader.releaseLock();
      }
      if (text) publish(text);
      if (streamAbort.current === controller) streamAbort.current = null;
    }

    if (signedInUser.current !== owner) return;
    const finalOutcome = outcome as "done" | "interrupted" | "error" | "stopped" | "disconnected";
    const hasText = text.trim().length > 0;

    if (finalOutcome === "done" && hasText) {
      setInterruptedTurn(null);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: text, pending: false, interrupted: false } : message,
        ),
      );
      return;
    }

    if (finalOutcome === "stopped") {
      // The user chose to stop: keep the partial answer, quietly.
      if (!hasText) {
        setMessages((current) => current.filter((message) => message.id !== assistantId));
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? { ...message, content: text, pending: false, interrupted: false }
            : message,
        ),
      );
      return;
    }

    // Everything else keeps the turn retryable with one tap.
    setInterruptedTurn({ assistantId, turnId, modelId, fileIds, payloadMessages });
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, content: text, pending: false, interrupted: true }
          : message,
      ),
    );
  };

  const retryTurn = async () => {
    const turn = interruptedTurn;
    if (!turn || sendLock.current || conversationLoading) return;
    sendLock.current = true;

    setInterruptedTurn(null);
    setBusy(true);
    shouldStickToBottom.current = true;
    const assistantId = makeId();
    setMessages((current) => [
      ...current.filter((message) => message.id !== turn.assistantId),
      { id: assistantId, role: "assistant", content: "", pending: true, kind: "text", startedAt: Date.now() },
    ]);

    try {
      await runTextTurn(turn.payloadMessages, turn.turnId, assistantId, turn.modelId, turn.fileIds);
      void Promise.all([refreshConversations(search, { silent: true }), refreshUsage()]);
    } finally {
      sendLock.current = false;
      setBusy(false);
    }
  };

  const stopGenerating = () => {
    uploadAbort.current?.abort();
    streamAbort.current?.abort();
    imagePollAbort.current?.abort();
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || sendLock.current || conversationLoading) return;
    if (offline) { pushNotice(locale === "fa" ? "اتصال اینترنت را بررسی کن؛ پیامت اینجا باقی می‌ماند." : "Check your connection. Your message is still here.", "info"); return; }

    if (selectedModel.type === "image" && (cleanPrompt.length < 3 || cleanPrompt.length > 5000)) {
      pushNotice(locale === "fa" ? "توضیح تصویر باید بین ۳ تا ۵۰۰۰ نویسه باشد." : "Describe your image in 3 to 5000 characters.", "info");
      return;
    }

    if (authStatus === "checking") {
      pushNotice(ui.chat.sessionChecking, "info");
      return;
    }

    if (authStatus === "unavailable") {
      pushNotice(ui.chat.sessionUnavailable, "error");
      void refreshSession();
      return;
    }

    if (!session) {
      setAuthInitialMode("login");
      setAuthOpen(true);
      return;
    }

    const owner = session.id;
    sendLock.current = true;
    setBusy(true);
    let uploadedFileIds: string[] = [];

    if (files.length && selectedModel.type === "text") {
      const uploadController = new AbortController();
      uploadAbort.current = uploadController;
      setUploading(true);
      try {
        const planned = await fetch("/api/uploads/presign", {
          signal: uploadController.signal,
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            files: files.map((file) => ({
              name: file.name,
              type: uploadMime(file),
              size: file.size,
            })),
          }),
        });
        const planData = await planned.json();
        if (!planned.ok) throw new Error(planData.error || t.uploadFailed);

        await Promise.all(
          planData.uploads.map(
            (
              upload: { uploadUrl: string; headers: Record<string, string> },
              index: number,
            ) =>
              fetch(upload.uploadUrl, {
                signal: uploadController.signal,
                method: "PUT",
                headers: upload.headers,
                body: files[index],
              }).then((response) => {
                if (!response.ok) throw new Error(t.uploadFailed);
              }),
          ),
        );

        const completed = await fetch("/api/uploads/complete", {
          signal: uploadController.signal,
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({ ids: planData.uploads.map((upload: { id: string }) => upload.id) }),
        });
        const completedData = await completed.json();
        if (!completed.ok) throw new Error(completedData.error || t.uploadFailed);
        uploadedFileIds = completedData.fileIds;
      } catch (error) {
        uploadController.abort();
        sendLock.current = false;
        setBusy(false);
        pushNotice(error instanceof Error && error.name === "AbortError" ? (locale === "fa" ? "بارگذاری متوقف شد؛ فایل‌ها و پیام حفظ شدند." : "Upload stopped. Your files and message are preserved.") : error instanceof Error ? error.message : t.uploadFailed, "info");
        return;
      } finally {
        setUploading(false);
        uploadAbort.current = null;
      }
    }

    if (signedInUser.current !== owner) { sendLock.current = false; setBusy(false); return; }
    const userMessage: Message = {
      id: makeId(),
      role: "user",
      content: cleanPrompt,
    };
    const assistantId = makeId();
    const turnId = newTurnId();

    shouldStickToBottom.current = true;
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: "assistant", content: "", pending: true, kind: selectedModel.type, startedAt: Date.now() },
    ]);
    setPrompt("");
    setBusy(true);

    try {
      if (selectedModel.type === "image") {
        const pollController = new AbortController();
        imagePollAbort.current = pollController;
        let pollTimedOut = false;
        const pollDeadline = window.setTimeout(() => { pollTimedOut = true; pollController.abort(); }, 150_000);
        try {
          const response = await fetch("/api/images", {
            signal: pollController.signal,
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrf,
            },
            body: JSON.stringify({
              prompt: cleanPrompt,
              model: selectedModel.id,
              conversationId: currentConversationId,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || t.imageTimeout);
          if (data.conversationId) setCurrentConversationId(data.conversationId);

          let result = data;
          for (let attempt = 0; attempt < 60 && !result.url; attempt += 1) {
            await abortableDelay(2000, pollController.signal);
            const statusResponse = await fetch(data.statusUrl, {
              credentials: "include",
              cache: "no-store",
              signal: pollController.signal,
            });
            result = await statusResponse.json().catch(() => ({}));
            if (!statusResponse.ok || result.status === "failed") {
              throw new Error(result.error || t.imageTimeout);
            }

          }

          if (!result.url) throw new Error(t.imageTimeout);
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    pending: false,
                    kind: "image",
                    content: result.revisedPrompt || t.imageReady,
                    imageUrl: result.url,
                  }
                : message,
            ),
          );
        } catch (error) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    pending: false,
                    kind: "image",
                    interrupted: false,
                    content: pollTimedOut ? t.imageTimeout : pollController.signal.aborted
                      ? (locale === "fa" ? "انتظار متوقف شد؛ اگر ساخت تصویر آغاز شده باشد، نتیجه در تاریخچه قابل مشاهده است." : "Stopped waiting. If generation started, its result will appear in history.")
                      : `${t.error}: ${error instanceof Error ? error.message : t.imageTimeout}`,
                  }
                : message,
            ),
          );
        } finally {
          window.clearTimeout(pollDeadline);
          imagePollAbort.current = null;
        }
      } else {
        const payloadMessages: TurnPayload[] = [...messages, userMessage]
          .filter((message) => !message.pending)
          .map(({ role, content }) => ({ role, content }));
        await runTextTurn(payloadMessages, turnId, assistantId, selectedModel.id, uploadedFileIds);
      }

      setFiles([]);
      void Promise.all([refreshConversations(search, { silent: true }), refreshUsage()]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t.conversationFailed;
      pushNotice(`${t.error}: ${errorMessage}`, "error");
      setMessages((current) => current.filter((message) => message.id !== assistantId));
    } finally {
      sendLock.current = false;
      setBusy(false);
      streamAbort.current = null;
      imagePollAbort.current = null;
    }
  };

  const logout = async () => {
    uploadAbort.current?.abort();
    streamAbort.current?.abort();
    imagePollAbort.current?.abort();
    openConversationAbort.current?.abort();
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", credentials: "include", headers: { "x-csrf-token": csrf },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("LOGOUT_FAILED");
      historySeq.current += 1;
      usageSeq.current += 1;
      clearSession();
      setUsage(null);
      setConversations([]);
      setHistoryState("idle");
      setInterruptedTurn(null);
      setConversationLoading(false);
      setConversationError(false);
      setMessages([]);
      setCurrentConversationId(null);
      setPrompt("");
      setFiles([]);
      await refreshModels();
    } catch {
      pushNotice(locale === "fa" ? "خروج انجام نشد؛ اتصال را بررسی و دوباره تلاش کن." : "Could not sign out. Check your connection and try again.", "error");
    }
  };

  const handleMessageScroll = () => {
    const scroller = messageScrollerRef.current;
    if (!scroller) return;
    shouldStickToBottom.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
    setShowScrollDown(!shouldStickToBottom.current);
  };

  const effectiveHistoryState: HistoryState = authStatus === "checking" ? "loading" : session ? historyState : "idle";
  const textUsage = usage?.text.find((item) => item.window === "3 hours") || usage?.text[0];
  const usagePercent =
    selectedModel.type === "image" ? usage?.image.usedPercent || 0 : textUsage?.usedPercent || 0;
  const usageLabel =
    selectedModel.type === "image" && usage
      ? `${usage.image.used}/${usage.image.limit}`
      : textUsage
        ? `${textUsage.used}/${textUsage.limit}`
        : `${usagePercent}%`;
  const formatDate = (value: string) => {
    try {
      return new Intl.DateTimeFormat(localeMeta[locale].tag, { dateStyle: "short" }).format(
        new Date(value),
      );
    } catch {
      return "";
    }
  };

  return (
    <main className={styles.shell} dir={direction} data-mode={selectedModel.type}>
      <a className={styles.skipLink} href="#portal-composer">{v.skip}</a>
      <aside ref={sidebarRef} id="portal-sidebar" className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`} aria-label={t.recent}>
        <div className={styles.sidebarHeader}>
          <Link className={styles.brand} href="/" aria-label={t.home}>
            <Logo className={styles.brandMark} priority />
            <span>
              Portal <b className={styles.brandAccent}>AI</b>
              <small>{v.workspace}</small>
            </span>
          </Link>
          <button
            className={styles.closeSidebarButton}
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label={t.close}
            title={t.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.sidebarControls}>
          <button className={styles.newChat} type="button" onClick={newChat} disabled={busy} aria-keyshortcuts="Control+Shift+O Meta+Shift+O" title={`${t.newChat} · Ctrl / ⌘ + Shift + O`}>
            <Plus size={18} />
            <span>{t.newChat}</span>
            <PenLine size={15} aria-hidden="true" />
          </button>
          <div className={styles.searchBox}>
            <Search size={16} aria-hidden="true" />
            <input
              className={styles.searchField}
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.search}
              aria-label={t.search}
              aria-controls="portal-history"
              autoComplete="off"
              aria-keyshortcuts="Control+K Meta+K"
            />
            {search ? <button type="button" className={styles.searchClear} onClick={() => { setSearch(""); searchInputRef.current?.focus(); }} aria-label={v.clearSearch}><X size={14} /></button> : <kbd className={styles.searchShortcut} aria-hidden="true">⌘ K</kbd>}
          </div>
        </div>

        <section className={styles.historyRegion} aria-labelledby="portal-history-heading">
          <div className={styles.historyHeading}>
            <span id="portal-history-heading">{t.recent}</span>
            {historyState === "ready" && conversations.length > 0 && (
              <span className={styles.historyCount}>{conversations.length}</span>
            )}
          </div>
          <div id="portal-history" className={styles.historyScroller}>
            {effectiveHistoryState === "loading" && (
              <div className={styles.historySkeleton} aria-label={t.loading} aria-busy="true">
                <div className={styles.historySkeletonItem} />
                <div className={styles.historySkeletonItem} />
                <div className={styles.historySkeletonItem} />
              </div>
            )}

            {effectiveHistoryState === "error" && (
              <div className={styles.historyStatus} role="status">
                <AlertTriangle size={20} aria-hidden="true" />
                <span>{t.historyUnavailable}</span>
                <button
                  className={styles.retryButton}
                  type="button"
                  onClick={() => void refreshConversations(search)}
                >
                  <RefreshCw size={15} />
                  {t.retry}
                </button>
              </div>
            )}

            {effectiveHistoryState === "idle" && (
              <div className={styles.historyStatus}>
                <MessageCircleMore size={20} aria-hidden="true" />
                <span>{t.signInHistory}</span>
                <button
                  className={styles.retryButton}
                  type="button"
                  onClick={() => {
                    setAuthInitialMode("login");
                    setAuthOpen(true);
                  }}
                >
                  <LogIn size={15} />
                  {t.signIn}
                </button>
              </div>
            )}

            {effectiveHistoryState === "ready" && !conversations.length && (
              <div className={styles.historyStatus}>
                <MessageCircleMore size={20} aria-hidden="true" />
                <span>{search.trim() ? v.noResults : t.noHistory}</span>
                {search.trim() && <button className={styles.retryButton} type="button" onClick={() => setSearch("")}>{v.clearSearch}</button>}
              </div>
            )}

            {effectiveHistoryState === "ready" &&
              groupedHistory.map(({ bucket, items }) => (
                <section className={styles.historyGroup} key={bucket} aria-label={v[bucket]}>
                  <h3 className={styles.historyGroupTitle}>{v[bucket]}</h3>
                  {items.map((conversation) => {
                const isActive = currentConversationId === conversation.id;
                const isOpening = openingConversationId === conversation.id;
                return (
                  <div
                    className={`${styles.historyItem} ${isActive ? styles.historyItemActive : ""} ${
                      isOpening ? styles.historyItemLoading : ""
                    }`}
                    key={conversation.id}
                  >
                    <button
                      className={styles.historyItemButton}
                      type="button"
                      onClick={() => void openConversation(conversation)}
                      disabled={busy || conversationLoading}
                      aria-busy={isOpening || undefined}
                      aria-current={isActive ? "page" : undefined}
                      title={conversation.title}
                    >
                      <span className={styles.historyItemIcon}>
                        {isOpening ? (
                          <i className={styles.spinner} aria-hidden="true" />
                        ) : (
                          <MessageCircleMore size={15} aria-hidden="true" />
                        )}
                      </span>
                      <span className={styles.historyText}>
                        <b className={styles.historyTitle} dir="auto">
                          {conversation.title}
                        </b>
                        <small className={styles.historyDate}>{formatDate(conversation.updated_at)}</small>
                      </span>
                    </button>
                    <div className={styles.historyActions}>
                      <a
                        className={styles.historyAction}
                        href={`/api/conversations/${conversation.id}/export?format=md`}
                        aria-label={`${t.export}: ${conversation.title}`}
                        title={t.export}
                      >
                        <Download size={15} aria-hidden="true" />
                      </a>
                      <button
                        className={`${styles.historyAction} ${styles.historyActionDanger}`}
                        type="button"
                        onClick={() => setDeleteTarget(conversation.id)}
                        disabled={busy}
                        aria-label={`${t.delete}: ${conversation.title}`}
                        title={t.delete}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
                  })}
                </section>
              ))}
          </div>
        </section>

        <footer className={styles.sidebarFooter}>
          <nav className={styles.navLinks} aria-label={t.menu}>
            <Link className={styles.navLink} href="/studio">
              <ImageIcon size={16} aria-hidden="true" />
              <span>{t.studio}</span>
            </Link>
            <Link className={styles.navLink} href="/models">
              <Layers3 size={16} aria-hidden="true" />
              <span>{t.models}</span>
            </Link>
            <Link className={styles.navLink} href="/plans">
              <WalletCards size={16} aria-hidden="true" />
              <span>{t.plans}</span>
            </Link>
          </nav>
          <div className={styles.footerLinks}>
            <Link className={styles.footerLink} href="/">
              <Home size={16} aria-hidden="true" />
              <span>{t.home}</span>
            </Link>
            {session?.role === "admin" && (
              <Link className={styles.footerLink} href="/admin">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>{t.admin}</span>
              </Link>
            )}
          </div>
          {session ? (
            <button
              className={styles.userCard}
              type="button"
              onClick={(event) => { setHubAnchor(event.currentTarget); setHubOpen((value) => hubAnchor === event.currentTarget ? !value : true); }}
              aria-haspopup="dialog"
              aria-expanded={hubOpen}
              aria-controls="account-popover"
              aria-label={t.account}
            >
              <span className={styles.userAvatar} aria-hidden="true">
                {(session.username || session.displayName || "P").slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.userMeta}>
                <b dir="auto">{session.username || session.displayName || session.phoneMasked}</b>
                <small>{t.planUsage}: {usageLabel}</small>
                <span className={styles.userQuotaBar} aria-hidden="true">
                  <i style={{ inlineSize: `${usagePercent}%` } as CSSProperties} />
                </span>
              </span>
              <PlanBadge plan={session.plan} />
            </button>
          ) : (
            <button
              className={`${styles.userCard} ${styles.userCardGuest}`}
              disabled={authStatus === "checking"}
              type="button"
              onClick={() => {
                setAuthInitialMode("login");
                setAuthOpen(true);
              }}
            >
              <span className={`${styles.userAvatar} ${styles.userAvatarGhost}`} aria-hidden="true">
                <UserRound size={18} />
              </span>
              <span className={styles.userMeta}>
                <b>{authStatus === "checking" ? ui.chat.sessionChecking : ui.hub.guestAction}</b>
                <small>{ui.hub.guestTitle}</small>
              </span>
              <LogIn size={16} aria-hidden="true" className={styles.userCardArrow} />
            </button>
          )}
        </footer>
      </aside>

      {sidebarOpen && (
        <button
          className={styles.sidebarScrim}
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label={t.close}
        />
      )}

      <section className={styles.main} inert={sidebarOpen || undefined}>
        <header className={styles.topbar}>
          <div className={styles.topbarStart}>
            <button
              className={styles.mobileMenuButton}
              ref={menuButtonRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={t.menu}
              title={t.menu}
              aria-expanded={sidebarOpen}
              aria-controls="portal-sidebar"
            >
              <Menu size={20} />
            </button>
            <div className={styles.popoverWrap} ref={modelPopoverRef}>
              <button
                className={styles.modelTrigger}
                ref={modelButtonRef}
                type="button"
                onClick={() => { setModelSearch(""); setModelOpen((current) => !current); }}
                disabled={busy || conversationLoading}
                aria-expanded={modelOpen}
                aria-haspopup="dialog"
                aria-controls="portal-model-menu"
              >
                <span className={styles.modelIcon}>
                  {selectedModel.type === "image" ? (
                    <ImageIcon size={17} aria-hidden="true" />
                  ) : (
                    <Sparkles size={17} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.modelCopy}>
                  <b>{selectedModel.name}</b>
                  <small>{selectedModel.description || modelDescriptions[locale][selectedModel.id] || "Portal AI"}</small>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {modelOpen && (
                <>
                  <button
                    className={styles.modelSheetScrim}
                    type="button"
                    onClick={() => setModelOpen(false)}
                    aria-label={t.close}
                    tabIndex={-1}
                  />
                  <div id="portal-model-menu" className={styles.modelMenu} role="dialog" aria-label={t.selectModel} onKeyDown={(event) => {
                    if (event.key !== "Tab") return;
                    const controls = event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)');
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                  }}>
                    <span className={styles.modelSheetHandle} aria-hidden="true" />
                    <div className={styles.modelMenuHeader}>
                    <b>{t.models}</b>
                    <small>
                      {catalog.length} · {t.text} + {t.image}
                    </small>
                  </div>
                  <label className={styles.modelSearch}>
                    <Search size={16} aria-hidden="true" />
                    <input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder={v.modelSearch} aria-label={v.modelSearch} autoFocus />
                  </label>
                  {!modelGroups.length && <p className={styles.modelEmpty}>{v.noModels}</p>}
                  {modelGroups.map(([provider, models]) => (
                    <section className={styles.providerGroup} key={provider}>
                      <div className={styles.providerHeading}>
                        <span>{provider}</span>
                        <small>{models.length}</small>
                      </div>
                      {models.map((model) => {
                        const selected = model.id === selectedModel.id;
                        return (
                          <button
                            className={`${styles.modelOption} ${
                              selected ? styles.modelOptionSelected : ""
                            } ${model.available === false ? styles.modelOptionLocked : ""}`}
                            key={model.id}
                            type="button"
                            onClick={() => chooseModel(model)}
                            aria-pressed={selected}
                          >
                            <span className={styles.modelIcon}>
                              {model.type === "image" ? (
                                <ImageIcon size={15} aria-hidden="true" />
                              ) : (
                                <Bot size={15} aria-hidden="true" />
                              )}
                            </span>
                            <span className={styles.modelCopy}>
                              <b>
                                {model.name}
                                {model.type === "image" && <i className={styles.imageLabel}>{t.image}</i>}
                              </b>
                              <small>{model.description || modelDescriptions[locale][model.id] || provider}</small>
                            </span>
                            <span className={styles.modelOptionMeta}>
                              <em>
                                {model.creditCost || 1} {t.credit}
                              </em>
                              {model.available === false ? (
                                <LockKeyhole size={15} aria-label={t.modelLocked} />
                              ) : (
                                selected && <Check size={16} aria-label={t.selectModel} />
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.modeSwitch} role="group" aria-label={t.switchMode}>
            <button type="button" aria-pressed={selectedModel.type === "text"} disabled={busy || conversationLoading} onClick={() => chooseType("text")}><MessageCircleMore size={16} /><span>{v.textMode}</span></button>
            <button type="button" aria-pressed={selectedModel.type === "image"} disabled={busy || conversationLoading} onClick={() => chooseType("image")}><ImageIcon size={16} /><span>{v.imageMode}</span></button>
          </div>
          <div className={styles.topbarActions}>
            {session ? (
              <button
                className={styles.accountButton}
                type="button"
                onClick={(event) => { setHubAnchor(event.currentTarget); setHubOpen((value) => hubAnchor === event.currentTarget ? !value : true); }}
                aria-haspopup="dialog"
                aria-expanded={hubOpen}
              aria-controls="account-popover"
                title={t.account}
              >
                <span className={styles.accountChipAvatar} aria-hidden="true">
                  {(session.username || session.displayName || "P").slice(0, 1).toUpperCase()}
                </span>
                <span className={styles.accountChipName} dir="auto">
                  {session.username || session.displayName || session.phoneMasked}
                </span>
              </button>
            ) : (
              <button
                className={styles.signInButton}
                disabled={authStatus === "checking"}
                type="button"
                onClick={() => {
                  setAuthInitialMode("login");
                  setAuthOpen(true);
                }}
              >
                <LogIn size={16} aria-hidden="true" />
                <span>{t.signIn}</span>
              </button>
            )}
          </div>
        </header>

        <section className={styles.chatViewport} aria-label={t.conversation}>
          <div
            className={styles.messageScroller}
            ref={messageScrollerRef}
            onScroll={handleMessageScroll}
            aria-busy={conversationLoading || undefined}
          >
            {conversationLoading ? (
              <div className={styles.chatSkeleton} role="status" aria-label={t.loadingConversation}>
                {[0, 1, 2, 3].map((row) => (
                  <div
                    className={styles.chatSkeletonRow}
                    key={row}
                    data-side={row % 2 === 1 ? "user" : "assistant"}
                  >
                    <span className={styles.chatSkeletonAvatar} aria-hidden="true" />
                    <span className={styles.chatSkeletonBubble} aria-hidden="true">
                      <i style={{ inlineSize: `${64 - row * 9}%` }} />
                      <i style={{ inlineSize: `${42 - row * 5}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            ) : conversationError ? (
              <div className={styles.chatErrorState} role="alert">
                <AlertTriangle size={22} aria-hidden="true" />
                <p>{t.conversationFailed}</p>
                <button className={styles.retryButton} type="button" onClick={retryOpenConversation}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {t.retry}
                </button>
              </div>
            ) : !messages.length ? (
              <div className={`${styles.emptyState} ${selectedModel.type === "image" ? styles.emptyStateImage : ""}`}>
                <div className={styles.emptyMark} aria-hidden="true">
                  {selectedModel.type === "image" ? <WandSparkles size={30} strokeWidth={1.5} /> : <Logo />}
                </div>
                <span className={styles.statusPill}>
                  <span aria-hidden="true" />
                  {t.ready.replace("Sirius", selectedModel.name)}
                </span>
                <h1>{selectedModel.type === "image" ? t.imageQuestion : t.textQuestion}</h1>
                <p>{selectedModel.type === "image" ? t.imageIntro : t.textIntro}</p>
                {selectedModel.type === "image" && showSuggestions && <button type="button" className={styles.studioPreview} onClick={() => fillPrompt(v.showcasePrompt)}>
                  <Image unoptimized src="/portal-studio-art.webp" width={1536} height={1024} alt="" />
                  <span className={styles.studioPreviewLabel}>{v.visualExample}</span>
                  <span className={styles.studioPreviewAction}><WandSparkles size={15} />{v.useIdea}<ArrowUpRight size={16} /></span>
                </button>}
                {showSuggestions && (
                  <section className={styles.ideasSection} aria-label={selectedModel.type === "image" ? v.imageIdeas : v.promptIdeas}>
                    <div className={styles.ideasHeading}><span>{selectedModel.type === "image" ? v.imageIdeas : v.promptIdeas}</span><span aria-hidden="true">{selectedModel.type === "image" ? "03" : "04"}</span></div>
                    {selectedModel.type === "image" ? (
                      <div className={styles.imageIdeas}>
                        {[
                          { key: "product", title: v.imgProduct, subtitle: v.imgProductSub, prompt: v.imgProductPrompt },
                          { key: "space", title: v.imgSpace, subtitle: v.imgSpaceSub, prompt: v.imgSpacePrompt },
                          { key: "art", title: v.imgArt, subtitle: v.imgArtSub, prompt: v.imgArtPrompt },
                        ].map((idea) => <button className={styles.imageIdea} type="button" key={idea.key} onClick={() => fillPrompt(idea.prompt)}>
                          <span className={styles.ideaArtwork} data-art={idea.key} aria-hidden="true"><i /><i /><i /></span>
                          <span className={styles.imageIdeaCopy}><b>{idea.title}</b><small>{idea.subtitle}</small></span>
                          <ArrowUpRight size={16} className={styles.ideaArrow} aria-hidden="true" />
                        </button>)}
                      </div>
                    ) : (
                      <div className={styles.suggestionGrid}>
                        {[
                          { icon: Clock3, title: t.s1, subtitle: t.s1sub, prompt: t.s1prompt },
                          { icon: PenLine, title: v.writing, subtitle: v.writingSub, prompt: v.writingPrompt },
                          { icon: Code2, title: t.s2, subtitle: t.s2sub, prompt: t.s2prompt },
                          { icon: Lightbulb, title: t.s3, subtitle: t.s3sub, prompt: t.s3prompt, image: true },
                        ].map((idea) => <button className={styles.suggestion} type="button" key={idea.title} onClick={() => { if (idea.image) chooseType("image"); fillPrompt(idea.prompt); }}>
                          <span className={styles.suggestionIcon}><idea.icon size={19} strokeWidth={1.6} aria-hidden="true" /></span>
                          <span className={styles.suggestionCopy}><b>{idea.title}</b><small>{idea.subtitle}</small></span>
                          <ArrowUpRight className={styles.suggestionArrow} size={15} aria-hidden="true" />
                        </button>)}
                      </div>
                    )}
                  </section>
                )}
              </div>
            ) : (
              <div className={styles.messages} ref={messageContentRef}>
                {messages.map((message) => (
                  <article
                    className={`${styles.messageRow} ${
                      message.role === "user" ? styles.messageRowUser : ""
                    }`}
                    key={message.id}
                  >
                    <div className={styles.messageAvatar}>
                      {message.role === "assistant" ? <Logo /> : <UserRound size={17} />}
                    </div>
                    <div
                      className={`${styles.messageContent} ${
                        message.role === "assistant" && !message.pending ? styles.messageContentDone : ""
                      }`}
                      dir="auto"
                    >
                      <div className={styles.messageAuthor} dir={direction}>{message.role === "user" ? v.you : v.assistant}</div>
                      {message.imageUrl && (
                        <GeneratedImage src={message.imageUrl} alt={message.content || t.imageReady} lang={locale} />
                      )}
                      {message.pending && (message.kind === "image" || !message.content) ? (
                        <GenerationStatus locale={locale} mode={message.kind || "text"} startedAt={message.startedAt} />
                      ) : message.role === "assistant" ? (
                        <>
                          {message.content ? <MarkdownLite text={message.content} locale={locale} /> : null}
                          {message.pending && <i className={styles.streamCaret} aria-hidden="true" />}
                          {message.interrupted && !message.pending && (
                            <div className={styles.interruptedBar}>
                              <AlertTriangle size={13} aria-hidden="true" />
                              <span>{t.turnInterrupted}</span>
                              {interruptedTurn?.assistantId === message.id && (
                                <button
                                  type="button"
                                  className={styles.interruptedRetry}
                                  onClick={() => void retryTurn()}
                                >
                                  <RefreshCw size={12} aria-hidden="true" />
                                  {t.retry}
                                </button>
                              )}
                            </div>
                          )}
                          {!message.pending && message.content && (
                            <button
                              type="button"
                              className={styles.messageCopy}
                              onClick={() => void copyMessage(message.content)}
                              aria-label={ui.chat.copy}
                              title={ui.chat.copy}
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                          )}
                        </>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          {showScrollDown && messages.length > 0 && (
            <button type="button" className={styles.scrollDown} onClick={() => {
              shouldStickToBottom.current = true;
              setShowScrollDown(false);
              messageScrollerRef.current?.scrollTo({ top: messageScrollerRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
            }}><ArrowDown size={16} />{v.latest}</button>
          )}
        </section>

        <div className={styles.composerDock}>
          <div className={styles.composerFrame}>
            {offline && <div className={styles.connectionNotice} role="status"><WifiOff size={15} />{v.offline}</div>}
            {uploading && <div className={styles.uploadNotice} role="status"><span className={styles.spinner} />{v.uploading}</div>}
            {selectedModel.type === "image" && <div className={styles.styleBar} role="group" aria-label={v.styleLabel}>
              <span><Palette size={14} aria-hidden="true" />{v.styleLabel}</span>
              {["cinematic", "natural", "minimal", "illustrated"].map((style) => <button type="button" key={style} disabled={busy} aria-pressed={prompt.includes(v[`${style}Prompt`])} onClick={() => addStyle(v[`${style}Prompt`])}>{v[style]}</button>)}
            </div>}
            <form className={styles.composer} onSubmit={send}>
              {files.length > 0 && (
                <div className={styles.fileList} aria-label={t.attach}>
                  {files.map((file, index) => (
                    <span className={styles.fileChip} key={`${file.name}-${index}`} title={file.name}>
                      <FileText size={14} aria-hidden="true" />
                      <span className={styles.fileChipName}>{file.name}</span>
                      <button
                        className={styles.fileRemove}
                        disabled={busy}
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`${t.removeFile}: ${file.name}`}
                        title={t.removeFile}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                className={styles.composerTextarea}
                id="portal-composer"
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey || (sendOnEnter && !event.shiftKey && !event.altKey)) &&
                    !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={selectedModel.type === "image" ? t.imagePlaceholder : t.textPlaceholder}
                rows={1}
                maxLength={selectedModel.type === "image" ? 5000 : 16000}
                aria-label={selectedModel.type === "image" ? t.imagePlaceholder : t.textPlaceholder}
              />
              <div className={styles.composerToolbar}>
                <div className={styles.composerTools}>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      attachFiles(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <button
                    className={styles.composerAction}
                    type="button"
                    disabled={busy || selectedModel.type === "image"}
                    onClick={() => fileInput.current?.click()}
                    aria-label={t.attach}
                    title={t.attach}
                  >
                    <Paperclip size={18} />
                  </button>
                  <span className={styles.composerToolLabel}>{selectedModel.type === "image" ? v.imageResult : v.attachmentHint}</span>
                </div>
                <div className={styles.composerSubmit}>
                  <span className={styles.composerMeta}>
                    {busy ? v.generatingMeta : `${selectedModel.creditCost || 1} ${t.credit}` }
                  </span>
                  <button
                    className={`${styles.sendButton} ${busy ? styles.sendButtonStop : ""}`}
                    type={busy ? "button" : "submit"}
                    onClick={busy ? stopGenerating : undefined}
                    disabled={!busy && (!prompt.trim() || conversationLoading || offline || authStatus === "checking")}
                    aria-label={busy ? t.stop : t.send}
                    title={busy ? t.stop : t.send}
                  >
                    {busy ? <span className={styles.stopIcon} aria-hidden="true" /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            </form>
            <div className={styles.composerFootnote}>
              <span>{selectedModel.type === "image" ? v.imageGuide : v.footerNote}</span>
              <span className={styles.keyboardHint}>{sendOnEnter ? v.shortcut : v.ctrlSend}</span>
            </div>
            {prompt.length > (selectedModel.type === "image" ? 4500 : 15000) && <p className={styles.characterCount} role="status">{prompt.length.toLocaleString(localeMeta[locale].tag)} / {selectedModel.type === "image" ? "5,000" : "16,000"} {v.characters}</p>}
          </div>
        </div>
      </section>

      {authOpen && (
        <AuthDialog
          locale={locale}
          initialMode={authInitialMode}
          onClose={() => setAuthOpen(false)}
          onAuthenticated={(user, csrfToken) => {
            adoptSession(user, csrfToken);
            setAuthOpen(false);
            clearAuthQuery();
            if (continuePlanSelection()) return;
            void refreshModels();
          }}
        />
      )}
      {hubOpen && (
        <AccountHub
          anchor={hubAnchor}
          locale={locale}
          user={session}
          authStatus={authStatus}
          usage={usage}
          csrf={csrf}
          onClose={() => setHubOpen(false)}
          onOpenAuth={() => {
            setHubOpen(false);
            setAuthInitialMode("login");
            setAuthOpen(true);
          }}
          onLocaleChange={setLocale}
          onLogout={() => {
            setHubOpen(false);
            void logout();
          }}
          onSavedUsername={() => {
            void refreshSession();
            void refreshUsage();
          }}
          onPrefsChange={(prefs) => {
            if (prefs.sendOnEnter !== undefined) setSendOnEnter(prefs.sendOnEnter);
            if (prefs.showSuggestions !== undefined) setShowSuggestions(prefs.showSuggestions);
          }}
          pushNotice={pushNotice}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={ui.dialogs.deleteConversation}
        body={ui.dialogs.deleteConversationBody}
        confirmLabel={t.delete}
        locale={locale}
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteConversation(deleteTarget);
        }}
      />
      <ToastNotice notice={notice} onClose={() => setNotice(null)} locale={locale} />
    </main>
  );
}
