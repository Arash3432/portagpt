"use client";

import { ArrowUpLeft, Bot, Check, Image as ImageIcon, LockKeyhole, Search, SearchX, Sparkles, RefreshCw, X, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { PublicLocale, PublicSessionContext, PublicShell } from "./public-shell";
import styles from "./pages-refined.module.css";

type CatalogModel={id:string;name:string;description:string;type:"text"|"image";creditCost:number;available:boolean;requiredPlan:string;isDefault:boolean;providerKey:string;provider:string;providerOrder:number;displayOrder:number};
type ProviderMeta={name:string;intro:Record<PublicLocale,string>};

const providers:Record<string,ProviderMeta>={
  "portal-ai":{name:"Portal AI",intro:{fa:"انتخاب پیش‌فرض، اقتصادی و ساده برای شروع هر گفتگو.",en:"The balanced, economical default for starting any conversation.",ar:"الخيار الافتراضي المتوازن والاقتصادي لبدء أي محادثة.",zh:"适合开始任何对话的均衡、经济默认选择。"}},
  "z-ai":{name:"Z.ai",intro:{fa:"خانوادهٔ GLM برای تحلیل، نوشتن و کارهای چندمرحله‌ای.",en:"The GLM family for analysis, writing, and multi-step work.",ar:"عائلة GLM للتحليل والكتابة والمهام متعددة الخطوات.",zh:"适用于分析、写作和多步骤任务的 GLM 系列。"}},
  moonshotai:{name:"MoonshotAI",intro:{fa:"مدل‌های Kimi برای زمینه‌های طولانی، کدنویسی و پروژه‌های فنی.",en:"Kimi models for long context, coding, and technical projects.",ar:"نماذج Kimi للسياق الطويل والبرمجة والمشاريع التقنية.",zh:"适用于长上下文、编程和技术项目的 Kimi 模型。"}},
  anthropic:{name:"Anthropic",intro:{fa:"Claude برای استدلال عمیق، نگارش دقیق و کار حرفه‌ای.",en:"Claude for deep reasoning, careful writing, and professional work.",ar:"Claude للاستدلال العميق والكتابة الدقيقة والعمل الاحترافي.",zh:"Claude 适合深度推理、严谨写作与专业工作。"}},
  openai:{name:"OpenAI",intro:{fa:"خانوادهٔ GPT برای حل مسئله، کد، تولید محتوا و ساخت تصویر.",en:"The GPT family for problem solving, code, content, and images.",ar:"عائلة GPT لحل المشكلات والبرمجة والمحتوى والصور.",zh:"GPT 系列用于解决问题、编程、内容与图像创作。"}},
  google:{name:"Google",intro:{fa:"Gemini برای پاسخ سریع، ورودی‌های متنوع و تصویرسازی حرفه‌ای.",en:"Gemini for fast responses, multimodal work, and image creation.",ar:"Gemini للاستجابة السريعة والعمل متعدد الوسائط وإنشاء الصور.",zh:"Gemini 适合快速响应、多模态任务与图像创作。"}},
  "x-ai":{name:"SpaceXAI",intro:{fa:"Grok برای پاسخ‌های توانمند، تحلیل و کارهای پیچیده.",en:"Grok for capable answers, analysis, and complex work.",ar:"Grok للإجابات القوية والتحليل والمهام المعقدة.",zh:"Grok 适合高质量回答、分析与复杂任务。"}},
};

const copy:Record<PublicLocale,{eyebrow:string;title:string;intro:string;all:string;search:string;results:string;image:string;credit:string;from:string;open:string;locked:string;empty:string;clear:string;cta:string;plans:string}>={
  fa:{eyebrow:"مدل‌های Portal AI",title:"همهٔ انتخاب‌ها، مرتب و قابل مقایسه.",intro:"ابزار مناسب کارت را پیدا کن؛ مدل‌ها را بر اساس شرکت، نوع خروجی و دسترسی حساب خودت بررسی کن.",all:"همه",search:"نام مدل یا شرکت…",results:"مدل",image:"ساخت تصویر",credit:"اعتبار",from:"از پلن",open:"استفاده از مدل",locked:"نیازمند ارتقا",empty:"مدلی با این جستجو پیدا نشد.",clear:"پاک کردن",cta:"شروع گفتگو",plans:"مقایسه اشتراک‌ها"},
  en:{eyebrow:"Portal AI models",title:"Every option, organized and comparable.",intro:"Find the right tool for your next idea. Browse by provider, output type, and the models available to your account.",all:"All",search:"Model or company…",results:"models",image:"Image generation",credit:"credits",from:"From",open:"Use model",locked:"Upgrade required",empty:"No model matches this search.",clear:"Clear",cta:"Start chatting",plans:"Compare plans"},
  ar:{eyebrow:"نماذج Portal AI",title:"كل الخيارات مرتبة وسهلة المقارنة.",intro:"اعثر على الأداة المناسبة عبر تصفية الشركة ونوع المخرجات والنماذج المتاحة لحسابك.",all:"الكل",search:"النموذج أو الشركة…",results:"نموذج",image:"إنشاء صورة",credit:"رصيد",from:"من خطة",open:"استخدم النموذج",locked:"تحتاج ترقية",empty:"لا يوجد نموذج مطابق.",clear:"مسح",cta:"ابدأ المحادثة",plans:"قارن الخطط"},
  zh:{eyebrow:"Portal AI 模型",title:"所有选择，清晰分组，便于比较。",intro:"根据提供商、输出类型及账户权限，找到适合下一次创作的工具。",all:"全部",search:"模型或公司…",results:"个模型",image:"图像生成",credit:"积分",from:"起步套餐",open:"使用模型",locked:"需要升级",empty:"没有匹配的模型。",clear:"清除",cta:"开始对话",plans:"比较套餐"},
};

const detailCopy = {
  fa: { text: "گفتگو و متن", available: "قابل استفاده برای من", provider: "ارائه‌دهنده", loading: "در حال دریافت مدل‌ها…", failed: "فهرست مدل‌ها دریافت نشد.", retry: "دوباره تلاش کن", emptyCatalog: "در حال حاضر مدلی در فهرست نیست.", filters: "فیلتر مدل‌ها", ready: "در دسترس حساب شما", default: "پیش‌فرض", catalog: "فهرست زنده مدل‌ها" },
  en: { text: "Chat & text", available: "Available to me", provider: "Provider", loading: "Loading models…", failed: "We could not load the model catalog.", retry: "Try again", emptyCatalog: "No models are listed right now.", filters: "Filter models", ready: "Available to your account", default: "Default", catalog: "Live model catalog" },
  ar: { text: "المحادثة والنص", available: "المتاح لي", provider: "المزوّد", loading: "جارٍ تحميل النماذج…", failed: "تعذّر تحميل قائمة النماذج.", retry: "حاول مجدداً", emptyCatalog: "لا توجد نماذج مدرجة حالياً.", filters: "تصفية النماذج", ready: "متاح لحسابك", default: "افتراضي", catalog: "قائمة النماذج الحالية" },
  zh: { text: "对话与文本", available: "我可使用的", provider: "提供商", loading: "正在加载模型…", failed: "无法加载模型目录。", retry: "重试", emptyCatalog: "目前没有列出的模型。", filters: "筛选模型", ready: "你的账户可使用", default: "默认", catalog: "实时模型目录" },
};

export function PortalModels() {
  return <PublicShell active="models">{(locale, session) => <ModelsContent locale={locale} session={session} />}</PublicShell>;
}

function ModelsContent({ locale, session }: { locale: PublicLocale; session: PublicSessionContext }) {
  const t = copy[locale];
  const d = detailCopy[locale];
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [provider, setProvider] = useState("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState<"all" | "text" | "image">("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const owner = `${session.user?.id || "guest"}:${session.user?.plan || "free"}`;
  const [loadedOwner, setLoadedOwner] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_unavailable");
        const data = await response.json();
        if (!Array.isArray(data.models)) throw new Error("catalog_invalid");
        if (controller.signal.aborted) return;
        setModels(data.models);
        setLoadedOwner(owner);
        setStatus("ready");
      }).catch(() => {
        if (!controller.signal.aborted) { setStatus("error"); setLoadedOwner(owner); }
      });
    return () => controller.abort();
  }, [owner, retry]);

  const loading = status === "loading" || loadedOwner !== owner;
  const providerOptions = useMemo(() => Array.from(new Map([...models].sort((a, b) => a.providerOrder - b.providerOrder).map((model) => [model.providerKey, model.provider])).entries()), [models]);
  const normalize = (value: string) => value.normalize("NFKC").replace(/ي/g, "ی").replace(/ك/g, "ک").toLocaleLowerCase(locale);
  const q = normalize(deferredQuery.trim());
  const visible = [...models].filter((model) =>
    (provider === "all" || model.providerKey === provider) &&
    (kind === "all" || model.type === kind) &&
    (!availableOnly || model.available) &&
    (!q || normalize(`${model.name} ${model.provider} ${model.description}`).includes(q))
  ).sort((a, b) => a.providerOrder - b.providerOrder || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  const groups = Array.from(visible.reduce((map, model) => {
    const list = map.get(model.providerKey) || [];
    list.push(model); map.set(model.providerKey, list); return map;
  }, new Map<string, CatalogModel[]>()).entries());
  const clearFilters = () => { setQuery(""); setProvider("all"); setKind("all"); setAvailableOnly(false); };
  const reload = () => { setStatus("loading"); setRetry((value) => value + 1); };
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  return <div className={`${styles.refined} ${styles.catalogPage}`}>
    <section className={`${styles.pageHero} public-container`}>
      <span className={styles.eyebrow}><span /><Sparkles size={15} />{t.eyebrow}</span>
      <h1>{t.title}</h1><p>{t.intro}</p>
      <div className={styles.heroMeta}><span>{d.catalog}</span><Link href="/plans">{t.plans}<ArrowUpLeft size={16} /></Link></div>
    </section>
    <section className="catalog-section public-container">
      <div className={styles.catalogTools}>
        <label className={styles.searchBox}><Search size={20} /><input type="search" aria-label={t.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} />{query && <button type="button" onClick={() => setQuery("")} aria-label={t.clear}><X size={17} /></button>}</label>
        <div className={styles.filterLine}>
          <div className={styles.segmented} role="group" aria-label={d.filters}>
            {(["all", "text", "image"] as const).map((type) => <button type="button" key={type} aria-pressed={kind === type} onClick={() => setKind(type)}>{type === "all" ? <SlidersHorizontal size={15} /> : type === "image" ? <ImageIcon size={15} /> : <Bot size={15} />}{type === "all" ? t.all : type === "text" ? d.text : t.image}</button>)}
          </div>
          <label className={styles.availableFilter}><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} />{d.available}</label>
          <span className={styles.resultCount} aria-live="polite">{loading ? d.loading : status === "ready" ? `${number(visible.length)} ${t.results}` : ""}</span>
        </div>
        <div className={styles.providerFilters} role="group" aria-label={d.provider}>
          <button type="button" aria-pressed={provider === "all"} onClick={() => setProvider("all")}>{t.all}</button>
          {providerOptions.map(([key, name]) => <button type="button" aria-pressed={provider === key} onClick={() => setProvider(key)} key={key}>{name}</button>)}
        </div>
      </div>
      {loading ? <div className={styles.skeletonGrid} role="status" aria-label={d.loading}>{[0, 1, 2, 3, 4, 5].map((item) => <div className={styles.skeletonCard} key={item}><i /><i /><i /></div>)}</div> : status === "error" ? <div className={styles.emptyState} role="alert"><RefreshCw size={28} /><h2>{d.failed}</h2><button type="button" onClick={reload}>{d.retry}</button></div> : groups.length ? <div className="provider-catalog">{groups.map(([key, items]) => {
        const meta = providers[key];
        return <section className={styles.providerSection} key={key}>
          <header className={styles.providerHeading}><div><span>{number(items.length).padStart(2, "0")}</span><h2>{items[0].provider}</h2></div><p>{meta?.intro[locale]}</p></header>
          <div className={styles.modelGrid}>{items.map((model) => <article className={styles.modelCard} data-kind={model.type} key={model.id}>
            <header><span className={styles.modelIcon}>{model.type === "image" ? <ImageIcon size={23} /> : model.isDefault ? <Sparkles size={23} /> : <Bot size={23} />}</span><div><small>{model.type === "image" ? t.image : d.text}</small><h3 dir="auto">{model.name}</h3></div>{model.isDefault && <span className={styles.modelBadge}>{d.default}</span>}</header>
            <p>{model.description || meta?.intro[locale]}</p>
            <dl className={styles.modelFacts}><div><dt>{t.credit}</dt><dd>{number(model.creditCost ?? 1)}</dd></div><div><dt>{t.from}</dt><dd>{model.requiredPlan}</dd></div></dl>
            <footer><span data-available={model.available}>{model.available ? <Check size={14} /> : <LockKeyhole size={14} />}{model.available ? d.ready : t.locked}</span><Link href={model.available ? `/app?model=${encodeURIComponent(model.id)}${model.type === "image" ? "&mode=image" : ""}` : "/plans"}>{model.available ? t.open : t.plans}<ArrowUpLeft size={17} /></Link></footer>
          </article>)}</div>
        </section>;
      })}</div> : <div className={styles.emptyState}><SearchX size={30} /><h2>{models.length ? t.empty : d.emptyCatalog}</h2><button type="button" onClick={models.length ? clearFilters : reload}>{models.length ? t.clear : d.retry}</button></div>}
    </section>
  </div>;
}
