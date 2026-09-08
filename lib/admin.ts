import { randomUUID } from "node:crypto";
import { db } from "./db";
import { getEnv } from "./env";
import { getClientIp, hashIp, isAdminIpOnlyAllowed } from "./security";
import { jsonError, requestError } from "./http";

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }

export async function requireAdminRead(request: Request): Promise<void> {
  if (!isAdminIpOnlyAllowed(getClientIp(request), getEnv().ADMIN_IP_ALLOWLIST)) {
    logAdminAccessDenied("ADMIN_IP_FORBIDDEN", request);
    throw new Error("ADMIN_IP_FORBIDDEN");
  }
}

function logAdminAccessDenied(reason: string, request: Request) {
  let path = "unknown";
  try { path = new URL(request.url).pathname; } catch { /* keep the safe fallback */ }
  console.warn("[portal-admin] access denied", {
    reason,
    method: request.method,
    path,
    clientIp: getClientIp(request),
  });
}

export function adminReadError(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "ADMIN_SESSION_MISSING") {
    return jsonError("نشست مدیر معتبر نیست؛ دوباره از پنل وارد شو.", 401, { "x-admin-deny-code": code });
  }
  if (code === "ADMIN_IP_FORBIDDEN") {
    // Do not reveal that this path is an administrator endpoint to an
    // unauthorized network. The page and its data APIs use the same 404.
    return jsonError("صفحه پیدا نشد.", 404);
  }
  if (code === "FORBIDDEN") return jsonError("صفحه پیدا نشد.", 404);
  return jsonError("داده‌های مدیریت موقتاً در دسترس نیست.", 503, { "x-admin-deny-code": "ADMIN_RUNTIME_UNAVAILABLE" });
}

export function adminMutationError(error: unknown, message: string) {
  const failure = requestError(error);
  if (failure) return failure;
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "ADMIN_IP_FORBIDDEN") return jsonError("صفحه پیدا نشد.", 404);
  if (code === "ADMIN_REAUTH_REQUIRED") return jsonError("برای این عملیات، هویت مدیر باید دوباره تأیید شود.", 428);
  if (code === "ADMIN_USER_NOT_CONFIGURED") return jsonError("حساب مدیر فعال در پایگاه‌داده پیدا نشد.", 503);
  return jsonError(message, 403);
}

export async function writeAdminAudit(input: {
  adminUserId: string;
  action: string;
  request: Request;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  const sql = db();
  await sql`
    insert into admin_audit_logs(admin_user_id,action,target_type,target_id,before_state,after_state,ip_hash,request_id)
    values(${input.adminUserId},${input.action},${input.targetType||null},${input.targetId||null},
           ${input.before===undefined?null:sql.json(jsonValue(input.before))},${input.after===undefined?null:sql.json(jsonValue(input.after))},
           ${hashIp(getClientIp(input.request))},${randomUUID()})
  `;
}
