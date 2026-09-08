export function jsonError(message: string, status = 400, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return Response.json({ error: message }, { status, headers: responseHeaders });
}

export function authError(code: string, message: string, status = 400, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return Response.json({ error: message, code }, { status, headers: responseHeaders });
}

export function runtimeUnavailable() {
  return jsonError("سرویس هنوز به زیرساخت امن متصل نشده است.", 503);
}

export function noStoreJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export async function parseJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("INVALID_CONTENT_TYPE");
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw new Error("BODY_TOO_LARGE");
  if (!request.body) throw new Error("EMPTY_BODY");
  const bytes = await readBoundedBody(request.body, maxBytes, "BODY_TOO_LARGE");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_JSON"); }
}

export async function parseJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readResponseBytes(response, maxBytes);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_UPSTREAM_JSON"); }
}

async function readBoundedBody(body: ReadableStream<Uint8Array>, maxBytes: number, overflowCode: string) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("INVALID_BODY_LIMIT");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(overflowCode);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function readResponseBytes(response: Response, maxBytes: number, overflowCode = "UPSTREAM_BODY_TOO_LARGE") {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(overflowCode);
  }
  if (!response.body) throw new Error("EMPTY_UPSTREAM_BODY");
  return readBoundedBody(response.body, maxBytes, overflowCode);
}

export function requestError(error: unknown): Response | null {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "UNAUTHORIZED") return authError(code, "برای ادامه وارد حساب شو.", 401);
  if (code === "INVALID_CSRF" || code === "INVALID_ORIGIN") return authError(code, "درخواست امنیتی معتبر نیست؛ صفحه را تازه کن.", 403);
  if (code === "BODY_TOO_LARGE") return authError(code, "حجم درخواست بیش از حد مجاز است.", 413);
  if (code === "INVALID_CONTENT_TYPE") return authError(code, "قالب درخواست معتبر نیست.", 415);
  if (code === "EMPTY_BODY" || code === "INVALID_JSON") return authError(code, "اطلاعات درخواست معتبر نیست.", 400);
  if (code === "PASSWORD_HASH_BUSY") return authError(code, "سرویس ورود شلوغ است؛ کمی بعد دوباره امتحان کن.", 503, { "retry-after": "5" });
  return null;
}
