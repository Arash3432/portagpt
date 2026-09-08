import { z } from "zod";
import { adminMutationError, adminReadError, requireAdminRead, writeAdminAudit } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { getEnv } from "../../../../lib/env";
import { jsonError, noStoreJson, parseJsonBody } from "../../../../lib/http";
import { invalidateProviderCache, providerRegistry, validateProviderBaseUrl } from "../../../../lib/provider";
import { assertSafeMutation } from "../../../../lib/security";
import { requireElevatedAdmin } from "../../../../lib/session";
import { encryptSecret } from "../../../../lib/vault";

export const runtime = "nodejs";

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,47}$/);
const pathSchema = z.string().regex(/^\/[A-Za-z0-9_./-]+$/).refine((value) => !value.includes("..") && !value.includes("//"));
const schema = z.object({
  action: z.enum(["upsert", "route", "remove-route"]).default("upsert"),
  providerId: idSchema.optional(), displayName: z.string().min(2).max(80).optional(), company: idSchema.optional(),
  baseUrl: z.string().url().optional(), chatPath: pathSchema.optional(), imagePath: pathSchema.optional(),
  enabled: z.boolean().optional(), isDefault: z.boolean().optional(), apiKey: z.string().min(12).max(500).optional(),
  scope: z.enum(["global", "company", "model"]).optional(), routeKey: z.string().min(1).max(120).optional(), routeProviderId: idSchema.optional(),
}).strict();

async function state() {
  const registry = await providerRegistry();
  const secretNames = registry.providers.map((provider) => provider.secretName);
  const sql = db();
  const secrets = secretNames.length ? await sql<Array<{ name: string; key_last_four: string | null }>>`select name,key_last_four from provider_secrets where name in ${sql(secretNames)}` : [];
  const env = getEnv();
  return {
    providers: registry.providers.map((provider) => ({ ...provider, baseUrl: provider.id === "legacy" ? env.AI_BASE_URL : provider.baseUrl, keyConfigured: Boolean(secrets.find((secret) => secret.name === provider.secretName) || (provider.id === "legacy" && env.AI_API_KEY)), keyLastFour: secrets.find((secret) => secret.name === provider.secretName)?.key_last_four || (provider.id === "legacy" && env.AI_API_KEY ? env.AI_API_KEY.slice(-4) : null) })),
    routes: registry.routes,
  };
}

export async function GET(request: Request) {
  try { await requireAdminRead(request); return noStoreJson(await state()); }
  catch (error) { return adminReadError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSafeMutation(request);
    const admin = await requireElevatedAdmin(request);
    const parsed = schema.safeParse(await parseJsonBody(request, 12_000));
    if (!parsed.success) return jsonError("تنظیمات Provider معتبر نیست.", 400);
    const before = await state();
    const current = await providerRegistry();
    const next = { providers: [...current.providers], routes: [...current.routes] };
    if (parsed.data.action === "route" || parsed.data.action === "remove-route") {
      if (!parsed.data.scope || !parsed.data.routeKey) return jsonError("محدوده و کلید Route لازم است.", 400);
      next.routes = next.routes.filter((route) => !(route.scope === parsed.data.scope && route.key === parsed.data.routeKey));
      if (parsed.data.action === "route") {
        if (!parsed.data.routeProviderId || !next.providers.some((provider) => provider.id === parsed.data.routeProviderId)) return jsonError("Provider مقصد پیدا نشد.", 404);
        next.routes.push({ scope: parsed.data.scope, key: parsed.data.routeKey, providerId: parsed.data.routeProviderId });
      }
    } else {
      if (!parsed.data.providerId || !parsed.data.displayName || !parsed.data.company || !parsed.data.baseUrl) return jsonError("شناسه، نام، شرکت و Base URL لازم است.", 400);
      const baseUrl = validateProviderBaseUrl(parsed.data.baseUrl);
      const entry = { id: parsed.data.providerId, displayName: parsed.data.displayName, company: parsed.data.company, baseUrl, chatPath: parsed.data.chatPath || "/chat/completions", imagePath: parsed.data.imagePath || "/images/generations", enabled: parsed.data.enabled !== false, isDefault: parsed.data.isDefault === true, secretName: parsed.data.providerId === "legacy" ? "liara_ai_api_key" : `provider_${parsed.data.providerId}` };
      const existing = next.providers.findIndex((provider) => provider.id === entry.id);
      if (existing === -1) next.providers.push(entry); else next.providers[existing] = { ...next.providers[existing], ...entry };
      if (entry.isDefault) next.providers = next.providers.map((provider) => ({ ...provider, isDefault: provider.id === entry.id }));
      if (parsed.data.apiKey) {
        const encrypted = encryptSecret(parsed.data.apiKey);
        await db()`insert into provider_secrets(name,ciphertext,iv,auth_tag,key_last_four,updated_by) values(${entry.secretName},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${parsed.data.apiKey.slice(-4)},${admin.userId}) on conflict(name) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,key_last_four=excluded.key_last_four,updated_by=excluded.updated_by,updated_at=now()`;
      }
    }
    const sql = db();
    await sql`insert into app_settings(key,value,updated_by) values('provider_config',${sql.json(next)},${admin.userId}) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`;
    invalidateProviderCache();
    const after = await state();
    await writeAdminAudit({ adminUserId: admin.userId, action: "providers.update", request, targetType: "provider_registry", targetId: parsed.data.providerId || parsed.data.routeKey || "registry", before, after: { ...after, apiKeyChanged: Boolean(parsed.data.apiKey) } });
    return noStoreJson({ ok: true, ...after });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ADMIN_REAUTH_REQUIRED") return jsonError("برای این تغییر، هویت مدیر باید دوباره تأیید شود.", 428);
    if (code === "CONFIG_VAULT_NOT_CONFIGURED" || code === "CONFIG_VAULT_KEY_INVALID") return jsonError("کلید رمزگذاری تنظیم نشده است.", 503);
    if (code === "PROVIDER_URL_INVALID") return jsonError("Base URL باید HTTPS عمومی با hostname باشد؛ آدرس IP و شبکه داخلی مجاز نیست.", 400);
    if (code === "PROVIDER_HOST_NOT_ALLOWLISTED") return jsonError("hostname این Provider در AI_PROVIDER_HOST_ALLOWLIST مجاز نشده است.", 400);
    return adminMutationError(error, "تنظیمات Provider ذخیره نشد.");
  }
}
