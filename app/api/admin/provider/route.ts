import { z } from "zod";
import { adminMutationError, adminReadError, requireAdminRead, writeAdminAudit } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { getEnv } from "../../../../lib/env";
import { jsonError, noStoreJson, parseJsonBody, parseJsonResponse } from "../../../../lib/http";
import { getProviderConfig, invalidateProviderCache } from "../../../../lib/provider";
import { assertSafeMutation } from "../../../../lib/security";
import { requireElevatedAdmin } from "../../../../lib/session";
import { encryptSecret } from "../../../../lib/vault";

export const runtime = "nodejs";
const pathSchema = z.string().regex(/^\/[A-Za-z0-9_./-]+$/).refine((value) => !value.includes("..") && !value.includes("//"));
const patchSchema = z.object({
  chatPath: pathSchema.optional(),
  imagePath: pathSchema.optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().min(12).max(500).optional(),
});

async function providerState() {
  const [settings, secrets] = await Promise.all([
    db()<Array<{ value: Record<string, unknown>; updated_at: string }>>`select value,updated_at from app_settings where key='provider_config'`,
    db()<Array<{ key_last_four: string | null; updated_at: string }>>`select key_last_four,updated_at from provider_secrets where name='liara_ai_api_key'`,
  ]);
  const value = settings[0]?.value || {};
  return {
    baseUrl: getEnv().AI_BASE_URL,
    chatPath: typeof value.chatPath === "string" ? value.chatPath : getEnv().AI_CHAT_PATH,
    imagePath: typeof value.imagePath === "string" ? value.imagePath : getEnv().AI_IMAGE_PATH,
    enabled: value.enabled !== false,
    keyConfigured: Boolean(secrets[0] || getEnv().AI_API_KEY),
    keyLastFour: secrets[0]?.key_last_four || (getEnv().AI_API_KEY ? getEnv().AI_API_KEY!.slice(-4) : null),
    keySource: secrets[0] ? "vault" : getEnv().AI_API_KEY ? "environment" : "missing",
    lastTestStatus: typeof value.lastTestStatus === "string" ? value.lastTestStatus : "never",
    lastTestAt: typeof value.lastTestAt === "string" ? value.lastTestAt : null,
    lastModelCount: typeof value.lastModelCount === "number" ? value.lastModelCount : null,
    updatedAt: settings[0]?.updated_at || null,
  };
}

export async function GET(request: Request) {
  try { await requireAdminRead(request); return noStoreJson(await providerState()); }
  catch (error) { return adminReadError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSafeMutation(request);
    const admin = await requireElevatedAdmin(request);
    const parsed = patchSchema.safeParse(await parseJsonBody(request, 4_000));
    if (!parsed.success) return jsonError("تنظیمات ارائه‌دهنده معتبر نیست.", 400);
    const before = await providerState();
    const next = {
      chatPath: parsed.data.chatPath || before.chatPath,
      imagePath: parsed.data.imagePath || before.imagePath,
      enabled: parsed.data.enabled ?? before.enabled,
      lastTestStatus: "changed",
      lastTestAt: null,
      lastModelCount: null,
    };
    const sql = db();
    await sql.begin(async (tx) => {
      await tx`insert into app_settings(key,value,updated_by) values('provider_config',${sql.json(next)},${admin.userId}) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`;
      if (parsed.data.apiKey) {
        const encrypted = encryptSecret(parsed.data.apiKey);
        await tx`insert into provider_secrets(name,ciphertext,iv,auth_tag,key_last_four,updated_by) values('liara_ai_api_key',${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${parsed.data.apiKey.slice(-4)},${admin.userId}) on conflict(name) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,key_last_four=excluded.key_last_four,updated_by=excluded.updated_by,updated_at=now()`;
      }
    });
    invalidateProviderCache();
    await writeAdminAudit({ adminUserId: admin.userId, action: "provider.update", request, targetType: "provider", targetId: "liara-ai", before, after: { ...next, apiKeyChanged: Boolean(parsed.data.apiKey) } });
    return noStoreJson({ ok: true, provider: await providerState() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ADMIN_REAUTH_REQUIRED") return jsonError("برای این تغییر، هویت مدیر باید دوباره تأیید شود.", 428);
    if (code === "CONFIG_VAULT_NOT_CONFIGURED" || code === "CONFIG_VAULT_KEY_INVALID") return jsonError("خزانه رمزگذاری هنوز در تنظیمات امن لیارا فعال نشده است.", 503);
    if (code === "PROVIDER_HOST_NOT_ALLOWLISTED" || code === "PROVIDER_URL_INVALID") return jsonError("Base URL فقط باید آدرس اختصاصی Liara AI ثبت‌شده برای Portal AI باشد.", 400);
    return adminMutationError(error, "تنظیمات ارائه‌دهنده ذخیره نشد.");
  }
}

export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    const admin = await requireElevatedAdmin(request);
    const parsed = z.object({ action: z.literal("test") }).safeParse(await parseJsonBody(request, 1_000));
    if (!parsed.success) return jsonError("درخواست تست معتبر نیست.", 400);
    invalidateProviderCache();
    const provider = await getProviderConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try { response = await fetch(`${provider.baseUrl}/models`, { headers: { authorization: `Bearer ${provider.apiKey}`, accept: "application/json" }, signal: controller.signal, redirect: "error", cache: "no-store" }); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`PROVIDER_TEST_${response.status}`);
    const payload = await parseJsonResponse(response, 2_000_000) as { data?: Array<{ id?: string }> };
    const ids = (payload.data || []).map((item) => item.id).filter((id): id is string => typeof id === "string");
    const expected = await db()<Array<{ provider_model: string }>>`select distinct provider_model from runtime_models where enabled=true`;
    const missing = expected.map((row) => row.provider_model).filter((id) => !ids.includes(id));
    const old = await db()<Array<{ value: Record<string, unknown> }>>`select value from app_settings where key='provider_config'`;
    const next = { ...(old[0]?.value || {}), lastTestStatus: missing.length ? "partial" : "healthy", lastTestAt: new Date().toISOString(), lastModelCount: ids.length };
    const sql=db();await sql`update app_settings set value=${sql.json(next)},updated_by=${admin.userId},updated_at=now() where key='provider_config'`;
    await writeAdminAudit({ adminUserId: admin.userId, action: "provider.test", request, targetType: "provider", targetId: "liara-ai", after: { status: next.lastTestStatus, modelCount: ids.length, missingCount: missing.length } });
    return noStoreJson({ ok: true, status: next.lastTestStatus, modelCount: ids.length, missingModels: missing });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ADMIN_REAUTH_REQUIRED") return jsonError("برای تست اتصال، هویت مدیر باید دوباره تأیید شود.", 428);
    if (code === "ADMIN_IP_FORBIDDEN") return jsonError("صفحه پیدا نشد.", 404);
    return jsonError("اتصال Liara AI تأیید نشد؛ کلید، Base URL یا دسترسی مدل‌ها را بررسی کن.", 502);
  }
}
