import { z } from "zod";
import { jsonError } from "../../../../lib/http";
import { getSession } from "../../../../lib/session";
import { getOwnedFile } from "../../../../lib/storage";
import { assetResponseHeaders } from "../../../../lib/asset-response";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request); if (!session) return jsonError("ورود لازم است.", 401);
    const { id } = await context.params; if (!z.string().uuid().safeParse(id).success) return jsonError("فایل پیدا نشد.", 404);
    const file = await getOwnedFile(session.userId, id); if (!file || !file.body) return jsonError("فایل پیدا نشد.", 404);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(file.body.transformToWebStream(), { headers: assetResponseHeaders(file, download) });
  } catch { return jsonError("فایل در دسترس نیست.", 503); }
}
