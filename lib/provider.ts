import { isIP } from "node:net";
import { db } from "./db";
import { getEnv } from "./env";
import { decryptSecret } from "./vault";

export type ProviderRouteScope = "global" | "company" | "model";
export type ProviderRoute = { scope: ProviderRouteScope; key: string; providerId: string };
export type ProviderRegistryEntry = {
  id: string;
  displayName: string;
  company: string;
  baseUrl: string;
  chatPath: string;
  imagePath: string;
  enabled: boolean;
  isDefault: boolean;
  secretName: string;
};
export type ProviderRegistry = { providers: ProviderRegistryEntry[]; routes: ProviderRoute[] };
export type ProviderConfig = ProviderRegistryEntry & {
  apiKey: string;
  keySource: "vault" | "environment";
};

let cached: { value: ProviderConfig; expiresAt: number } | null = null;

function normalizePath(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : fallback;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(text) || text.includes("..") || text.includes("//")) throw new Error("PROVIDER_PATH_INVALID");
  return text;
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  // Providers must use an explicitly allowlisted DNS hostname. Rejecting every
  // literal IP is stricter than checking a few IPv4 ranges and also covers IPv6,
  // IPv4-mapped IPv6, link-local metadata addresses, and unusual URL IP forms.
  if (isIP(host) !== 0) return true;
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home")
    || host.endsWith(".lan");
}

export function validateProviderBaseUrl(value: string, enforceEnvironmentAllowlist = true) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || isPrivateHost(url.hostname)) throw new Error("PROVIDER_URL_INVALID");
  if (enforceEnvironmentAllowlist) {
    const allowed = new Set(getEnv().AI_PROVIDER_HOST_ALLOWLIST.split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean));
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!allowed.has(hostname)) throw new Error("PROVIDER_HOST_NOT_ALLOWLISTED");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

function legacyProvider(validateBaseUrl = true): ProviderRegistryEntry {
  const env = getEnv();
  return { id: "legacy", displayName: "Legacy Environment Provider", company: "legacy", baseUrl: validateBaseUrl ? validateProviderBaseUrl(env.AI_BASE_URL, true) : env.AI_BASE_URL, chatPath: env.AI_CHAT_PATH, imagePath: env.AI_IMAGE_PATH, enabled: true, isDefault: true, secretName: "liara_ai_api_key" };
}

function parseRegistry(value: Record<string, unknown> | undefined, allowInvalidLegacyForDisplay = false): ProviderRegistry {
  // The admin page must be able to display a bad AI_BASE_URL/allowlist pair so
  // the operator can repair it. Runtime provider selection validates it again
  // before any outbound request is made.
  const legacy = legacyProvider(!allowInvalidLegacyForDisplay);
  const rawProviders = Array.isArray(value?.providers) ? value.providers : [];
  const providers = rawProviders.map((raw) => {
    const item = raw as Partial<ProviderRegistryEntry>;
    if (!item.id || !item.displayName || !item.company || !item.baseUrl || !item.secretName) return null;
    return {
      id: item.id, displayName: item.displayName, company: item.company, baseUrl: validateProviderBaseUrl(item.baseUrl),
      chatPath: normalizePath(item.chatPath, "/chat/completions"), imagePath: normalizePath(item.imagePath, "/images/generations"),
      enabled: item.enabled !== false, isDefault: item.isDefault === true, secretName: item.secretName,
    } satisfies ProviderRegistryEntry;
  }).filter((item): item is ProviderRegistryEntry => Boolean(item));
  const merged = providers.length ? providers : [legacy];
  if (!merged.some((provider) => provider.enabled && provider.isDefault)) merged[0].isDefault = true;
  const rawRoutes = Array.isArray(value?.routes) ? value.routes : [];
  const routes = rawRoutes.map((raw) => raw as Partial<ProviderRoute>).filter((route): route is ProviderRoute =>
    (route.scope === "global" || route.scope === "company" || route.scope === "model") && typeof route.key === "string" && typeof route.providerId === "string" && merged.some((provider) => provider.id === route.providerId),
  );
  return { providers: merged, routes };
}

async function readRegistry(allowInvalidLegacyForDisplay = false) {
  try {
    const [rows] = await Promise.all([db()<Array<{ value: Record<string, unknown> }>>`select value from app_settings where key='provider_config'`]);
    return parseRegistry(rows[0]?.value, allowInvalidLegacyForDisplay);
  } catch {
    return { providers: [legacyProvider(!allowInvalidLegacyForDisplay)], routes: [] };
  }
}

function chooseProvider(registry: ProviderRegistry, model?: { alias?: string; providerModel?: string }) {
  const enabled = registry.providers.filter((provider) => provider.enabled);
  if (!enabled.length) throw new Error("PROVIDER_DISABLED");
  const company = model?.providerModel?.split("/")[0] || "";
  const route = registry.routes.find((item) => item.scope === "model" && item.key === model?.alias)
    || registry.routes.find((item) => item.scope === "company" && item.key === company)
    || registry.routes.find((item) => item.scope === "global");
  const selected = enabled.find((provider) => provider.id === route?.providerId)
    || enabled.find((provider) => model?.providerModel?.startsWith(`${provider.company}/`))
    || enabled.find((provider) => provider.isDefault);
  if (!selected) throw new Error("PROVIDER_DISABLED");
  return selected;
}

export async function providerRegistry() { return readRegistry(true); }

export async function getProviderConfig(model?: { alias?: string; providerModel?: string }): Promise<ProviderConfig> {
  if (!model && cached && cached.expiresAt > Date.now()) return cached.value;
  const env = getEnv();
  const registry = await readRegistry();
  const selected = chooseProvider(registry, model);
  const validatedBaseUrl = validateProviderBaseUrl(selected.baseUrl, true);
  const secrets = await db()<Array<{ ciphertext: string; iv: string; auth_tag: string }>>`select ciphertext,iv,auth_tag from provider_secrets where name=${selected.secretName}`;
  const vaultSecret = secrets[0];
  const apiKey = vaultSecret ? decryptSecret({ ciphertext: vaultSecret.ciphertext, iv: vaultSecret.iv, authTag: vaultSecret.auth_tag }) : selected.id === "legacy" ? env.AI_API_KEY || "" : "";
  if (!apiKey) throw new Error("PROVIDER_API_KEY_NOT_CONFIGURED");
  const value: ProviderConfig = { ...selected, baseUrl: validatedBaseUrl, apiKey, keySource: vaultSecret ? "vault" : "environment" };
  if (!model) cached = { value, expiresAt: Date.now() + 30_000 };
  return value;
}

export async function providerEndpoint(kind: "chat" | "images", model?: { alias?: string; providerModel?: string }) {
  const config = await getProviderConfig(model);
  return `${config.baseUrl}${kind === "chat" ? config.chatPath : config.imagePath}`;
}

export function invalidateProviderCache() { cached = null; }
