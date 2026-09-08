import { z } from "zod";
import { db } from "./db";
import { getEnv } from "./env";

const planRanks: Record<string, number> = { free: 0, starter: 1, plus: 2, pro: 3, ultra: 4 };

const fallbackSchema = z.object({
  alias: z.string().regex(/^[a-z0-9-]+$/),
  providerModel: z.string().min(1),
  type: z.enum(["text", "image"]),
  enabled: z.boolean().default(true),
  inputUsdPerMillion: z.number().nonnegative().default(0),
  outputUsdPerMillion: z.number().nonnegative().default(0),
  imageCredits: z.number().int().positive().default(1),
  imageUsd: z.number().nonnegative().default(0),
  maxOutputTokens: z.number().int().min(128).max(131072).default(4096),
  messageCredits: z.number().int().min(1).max(100).default(1),
  displayOrder: z.number().int().min(0).max(1000).default(100),
});

export type PortalModel = {
  alias: string;
  displayName: string;
  description: string;
  providerModel: string;
  type: "text" | "image";
  enabled: boolean;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  imageCredits: number;
  imageUsd: number;
  imageSize: string | null;
  imageQuality: string | null;
  maxOutputTokens: number;
  messageCredits: number;
  displayOrder: number;
  minimumPlanRank: number;
  costMultiplier: number;
  isDefault: boolean;
  fallbackAlias: string | null;
  pricingSourceUrl: string | null;
  pricingCheckedAt: string | null;
};

let cache: { data: PortalModel[]; expiresAt: number } | null = null;

function validateCatalog(data: PortalModel[]) {
  const enabled = data.filter((model) => model.enabled);
  const textCount = enabled.filter((model) => model.type === "text").length;
  const imageCount = enabled.filter((model) => model.type === "image").length;
  const unsafe = enabled.some((model) => model.type === "text"
    ? model.inputUsdPerMillion <= 0 || model.outputUsdPerMillion <= 0
    : model.imageUsd <= 0);
  if (textCount < 5 || imageCount < 2 || unsafe || !enabled.some((model) => model.alias === "sirius" && model.type === "text")) {
    throw new Error("MODEL_CATALOG_REQUIRES_5_TEXT_2_IMAGE_AND_SIRIUS");
  }
  return data;
}

function fromEnvironment(): PortalModel[] {
  const raw = getEnv().MODEL_CATALOG_JSON;
  if (!raw) throw new Error("MODEL_CATALOG_NOT_MIGRATED");
  const parsed = z.array(fallbackSchema).min(7).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("INVALID_MODEL_CATALOG");
  const freeAliases=new Set(["sirius","glm-5-1","gpt-image-2"]);
  const starterAliases=new Set(["glm-5-2","gemini-3-5-flash","gemini-3-5-flash-lite"]);
  return parsed.data.map((model) => ({
    ...model,
    displayName: model.alias === "sirius" ? "Sirius" : model.alias,
    description: "",
    imageSize: model.type === "image" ? "1024x1024" : null,
    imageQuality: null,
    minimumPlanRank: freeAliases.has(model.alias)?0:starterAliases.has(model.alias)?1:2,
    costMultiplier: 1.5,
    isDefault: model.alias === "sirius",
    fallbackAlias: model.alias === "sirius" ? getEnv().SIRIUS_FALLBACK_MODEL_ALIAS || "glm-5-1" : null,
    pricingSourceUrl: null,
    pricingCheckedAt: null,
  }));
}

export async function modelCatalog() {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  let data: PortalModel[];
  try {
    const rows = await db()<Array<{
      alias: string; display_name: string; description: string; provider_model: string; type: "text" | "image"; enabled: boolean;
      input_usd_per_million: string | number; output_usd_per_million: string | number; image_credits: number; image_usd: string | number;
      image_size: string | null; image_quality: string | null; max_output_tokens: number; message_credits: number; display_order: number; minimum_plan_rank: number;
      cost_multiplier: string | number; is_default: boolean; fallback_alias: string | null; pricing_source_url: string | null; pricing_checked_at: string | null;
    }>>`
      select alias,display_name,description,provider_model,type,enabled,input_usd_per_million,
             output_usd_per_million,image_credits,image_usd,image_size,image_quality,
             max_output_tokens,message_credits,display_order,minimum_plan_rank,cost_multiplier,is_default,fallback_alias,
             pricing_source_url,pricing_checked_at
      from runtime_models order by type desc,is_default desc,minimum_plan_rank,display_name
    `;
    if (!rows.length) throw new Error("MODEL_CATALOG_EMPTY");
    data = rows.map((row) => ({
      alias: row.alias, displayName: row.display_name, description: row.description,
      providerModel: row.provider_model, type: row.type, enabled: row.enabled,
      inputUsdPerMillion: Number(row.input_usd_per_million), outputUsdPerMillion: Number(row.output_usd_per_million),
      imageCredits: Number(row.image_credits), imageUsd: Number(row.image_usd), imageSize: row.image_size,
      imageQuality: row.image_quality, maxOutputTokens: Number(row.max_output_tokens), messageCredits: Number(row.message_credits),
      displayOrder: Number(row.display_order), minimumPlanRank: Number(row.minimum_plan_rank),
      costMultiplier: Number(row.cost_multiplier), isDefault: row.is_default, fallbackAlias: row.fallback_alias,
      pricingSourceUrl: row.pricing_source_url, pricingCheckedAt: row.pricing_checked_at,
    }));
  } catch (error) {
    if (!getEnv().MODEL_CATALOG_JSON) throw error;
    data = fromEnvironment();
  }
  validateCatalog(data);
  cache = { data, expiresAt: Date.now() + 30_000 };
  return data;
}

export async function resolveModel(alias: string, type?: "text" | "image", planCode?: string) {
  const model = (await modelCatalog()).find((item) => item.alias === alias && item.enabled && (!type || item.type === type));
  if (!model) throw new Error("MODEL_NOT_AVAILABLE");
  if (planCode && (planRanks[planCode] ?? 0) < model.minimumPlanRank) throw new Error("MODEL_REQUIRES_HIGHER_PLAN");
  return model;
}

export async function publicModelCatalog(planCode = "free") {
  const rank = planRanks[planCode] ?? 0;
  const providerMeta: Record<string, { key: string; name: string; order: number }> = {
    "z-ai": { key: "z-ai", name: "Z.ai", order: 10 },
    moonshotai: { key: "moonshotai", name: "MoonshotAI", order: 20 },
    anthropic: { key: "anthropic", name: "Anthropic", order: 30 },
    openai: { key: "openai", name: "OpenAI", order: 40 },
    google: { key: "google", name: "Google", order: 50 },
    "x-ai": { key: "x-ai", name: "SpaceXAI", order: 60 },
  };
  return (await modelCatalog()).filter((model) => model.enabled).map((model) => {
    const prefix = model.providerModel.split("/")[0];
    const provider = model.alias === "sirius" ? { key: "portal-ai", name: "Portal AI", order: 0 } : providerMeta[prefix] || { key: prefix, name: prefix, order: 90 };
    return {
    id: model.alias,
    name: model.displayName,
    description: model.description,
    type: model.type,
    creditCost: model.type === "image" ? model.imageCredits : model.messageCredits,
    available: rank >= model.minimumPlanRank,
    requiredPlan: Object.entries(planRanks).find(([, value]) => value === model.minimumPlanRank)?.[0] || "free",
    isDefault: model.isDefault,
    providerKey: provider.key,
    provider: provider.name,
    providerOrder: provider.order,
    displayOrder: model.displayOrder,
  }; }).sort((a,b) => a.providerOrder-b.providerOrder || a.displayOrder-b.displayOrder || a.name.localeCompare(b.name));
}

export function effectiveTextRates(model: PortalModel) {
  return { input: model.inputUsdPerMillion * model.costMultiplier, output: model.outputUsdPerMillion * model.costMultiplier };
}

export function effectiveImageUsd(model: PortalModel) { return model.imageUsd * model.costMultiplier; }

export function invalidateModelCache() { cache = null; }
